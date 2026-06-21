const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const state = require('../state');
const { uploadVideo, attachCaptions, addToPlaylist } = require('../services/youtubeUpload');
const { uploadTitleFromFilename } = require('./recorder');
const { readChatLog } = require('./chatRecorder');
const { writeSrt } = require('./subtitleWriter');
const { isUploadQuotaError } = require('../services/youtubeQuota');

const DATA_DIR = process.env.DATA_DIR || './data';
const POLL_INTERVAL_MS = 5_000;
const QUOTA_RETRY_DELAY_MS = 60 * 60 * 1000;

let running = false;
let pollTimer = null;
const accountsOnQuotaCooldown = new Map();

function refreshQueueSnapshot() {
  const rows = db.prepare('SELECT * FROM upload_queue ORDER BY created_at').all();
  state.setQueueSnapshot(rows);
}

function nextPendingItem() {
  const candidates = db
    .prepare("SELECT * FROM upload_queue WHERE status = 'pending' ORDER BY created_at")
    .all();
  const now = Date.now();
  return candidates.find((item) => {
    const cooldownUntil = accountsOnQuotaCooldown.get(item.youtube_account_id);
    return !cooldownUntil || cooldownUntil <= now;
  });
}

function updateItem(id, fields) {
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  const values = Object.values(fields);
  db.prepare(`UPDATE upload_queue SET ${sets}, updated_at = ? WHERE id = ?`).run(
    ...values,
    new Date().toISOString(),
    id
  );
}

function maybeDeleteSourceFiles(filepath) {
  const remaining = db
    .prepare("SELECT COUNT(*) AS count FROM upload_queue WHERE filepath = ? AND status != 'done'")
    .get(filepath);
  if (remaining.count > 0) return;

  const srtPath = filepath.replace(/\.mkv$/, '.srt');
  for (const p of [filepath, srtPath]) {
    fs.promises.unlink(p).catch(() => {});
  }
}

async function processItem(item) {
  updateItem(item.id, { status: 'uploading', progress: 0 });
  refreshQueueSnapshot();

  try {
    const destination = db.prepare('SELECT * FROM channel_destinations WHERE id = ?').get(item.destination_id);
    const videoId = await uploadVideo(
      item.filepath,
      {
        accountId: item.youtube_account_id,
        title: item.title,
        privacy: (destination && destination.privacy) || 'unlisted',
        playlistId: item.playlist_id,
      },
      (progress) => {
        updateItem(item.id, { progress });
        refreshQueueSnapshot();
      }
    );

    const srtPath = item.filepath.replace(/\.mkv$/, '.srt');
    if (fs.existsSync(srtPath)) {
      try {
        await attachCaptions(videoId, srtPath, item.youtube_account_id);
        state.addEvent('captions_attached', item.channel, `Captions attached to video ${videoId}`);
      } catch (err) {
        state.addEvent('captions_failed', item.channel, `Failed to attach captions to video ${videoId}: ${err.message || err}`);
      }
    } else {
      state.addEvent('captions_skipped', item.channel, `No .srt file found for ${item.title}, skipping captions`);
    }

    db.prepare(
      `INSERT INTO upload_history (filepath, destination_id, youtube_video_id, uploaded_at, channel)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(filepath, destination_id) DO UPDATE SET youtube_video_id = excluded.youtube_video_id, uploaded_at = excluded.uploaded_at`
    ).run(item.filepath, item.destination_id, videoId, new Date().toISOString(), item.channel);

    updateItem(item.id, { status: 'done', progress: 100, error_message: null });
    state.addEvent('upload_end', item.channel, `Upload complete: ${item.title}`);

    maybeDeleteSourceFiles(item.filepath);
  } catch (err) {
    if (isUploadQuotaError(err)) {
      accountsOnQuotaCooldown.set(item.youtube_account_id, Date.now() + QUOTA_RETRY_DELAY_MS);
      updateItem(item.id, { status: 'pending', error_message: null });
      state.addEvent(
        'upload_quota_paused',
        item.channel,
        `YouTube daily upload quota exceeded for this account; will retry "${item.title}" in 1 hour`
      );
    } else {
      updateItem(item.id, { status: 'error', error_message: String(err.message || err) });
      state.addEvent('upload_fail', item.channel, `Upload failed: ${item.title}: ${err.message}`);
    }
  }

  refreshQueueSnapshot();
}

async function tick() {
  if (running) return;
  const item = nextPendingItem();
  if (!item) return;
  running = true;
  try {
    await processItem(item);
  } finally {
    running = false;
  }
}

function recoverChatLog(filepath) {
  const srtPath = filepath.replace(/\.mkv$/, '.srt');
  const chatLogPath = filepath.replace(/\.mkv$/, '.chat.jsonl');
  if (fs.existsSync(srtPath) || !fs.existsSync(chatLogPath)) return;

  const messages = readChatLog(chatLogPath);
  if (messages.length === 0) return;

  try {
    writeSrt(srtPath, messages);
    state.addEvent('chat_recovered', null, `Recovered ${messages.length} chat message(s) for ${path.basename(filepath)} after restart`);
  } catch (err) {
    // If writing fails, leave the .srt absent -- the upload will proceed without captions.
  }
  fs.unlink(chatLogPath, () => {});
}

function scanForOrphanedRecordings() {
  let files;
  try {
    files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.mkv'));
  } catch (err) {
    return;
  }

  for (const file of files) {
    const filepath = path.join(DATA_DIR, file);
    const hasQueueRows = db.prepare('SELECT COUNT(*) AS count FROM upload_queue WHERE filepath = ?').get(filepath);
    if (hasQueueRows.count > 0) continue;

    recoverChatLog(filepath);

    const channelName = file.split('_')[0];
    const channelRow = db.prepare('SELECT id FROM channels WHERE name = ?').get(channelName);
    if (!channelRow) continue;

    const destinations = db
      .prepare('SELECT * FROM channel_destinations WHERE channel_id = ? AND enabled = 1')
      .all(channelRow.id);

    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO upload_queue
        (filepath, channel, title, destination_id, youtube_account_id, playlist_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `);
    const uploadTitle = uploadTitleFromFilename(path.basename(file, '.mkv'));
    for (const dest of destinations) {
      insert.run(filepath, channelName, uploadTitle, dest.id, dest.youtube_account_id, dest.playlist_id, now, now);
    }
  }
}

function start() {
  scanForOrphanedRecordings();
  refreshQueueSnapshot();
  pollTimer = setInterval(tick, POLL_INTERVAL_MS);
  tick();
}

function retry(id) {
  const item = db.prepare('SELECT * FROM upload_queue WHERE id = ?').get(id);
  if (!item) return false;
  updateItem(id, { status: 'pending', error_message: null });
  refreshQueueSnapshot();
  tick();
  return true;
}

module.exports = { start, retry, refreshQueueSnapshot };
