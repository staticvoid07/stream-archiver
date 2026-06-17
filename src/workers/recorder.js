const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { db } = require('../db');
const { getSetting } = require('../config');
const state = require('../state');
const chatRecorder = require('./chatRecorder');
const { writeSrt } = require('./subtitleWriter');

const DATA_DIR = process.env.DATA_DIR || './data';
const STALE_CHECK_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

const activeRecordings = new Map();

function sanitizeTitle(title) {
  if (!title) return 'untitled';
  return title
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 100) || 'untitled';
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function buildFilename(channelName, startTime, title) {
  const y = startTime.getFullYear();
  const m = pad(startTime.getMonth() + 1);
  const d = pad(startTime.getDate());
  const hh = pad(startTime.getHours());
  const mm = pad(startTime.getMinutes());
  const ss = pad(startTime.getSeconds());
  return `${channelName}_${y}${m}${d}_${hh}${mm}${ss}_${sanitizeTitle(title)}.mkv`;
}

function isRecording(channelName) {
  return activeRecordings.has(channelName);
}

function startRecording(channel, streamInfo) {
  if (activeRecordings.has(channel.name)) return;

  const startTime = new Date();
  const quality = channel.quality || getSetting('default_recording_quality', '720p,480p,best');
  const filename = buildFilename(channel.name, startTime, streamInfo.title);
  const filepath = path.join(DATA_DIR, filename);

  const child = spawn('streamlink', [
    `https://twitch.tv/${channel.name}`,
    quality,
    '-o',
    filepath,
  ]);

  const recording = {
    channel: channel.name,
    filepath,
    startTime,
    child,
    lastSize: 0,
    lastSizeChangedAt: Date.now(),
    staleTimer: null,
  };

  recording.staleTimer = setInterval(() => {
    checkStale(recording);
  }, STALE_CHECK_INTERVAL_MS);

  activeRecordings.set(channel.name, recording);
  chatRecorder.attach(channel.name, startTime);

  state.setChannelState(channel.name, {
    status: 'recording',
    title: streamInfo.title,
    startedAt: startTime.toISOString(),
    fileSizeBytes: 0,
  });

  logEvent('recording_start', channel.name, `Recording started: ${filename}`);

  child.on('exit', () => {
    finalizeRecording(channel.name);
  });
}

function checkStale(recording) {
  let size;
  try {
    size = fs.statSync(recording.filepath).size;
  } catch (err) {
    return;
  }
  if (size !== recording.lastSize) {
    recording.lastSize = size;
    recording.lastSizeChangedAt = Date.now();
    state.setChannelState(recording.channel, { fileSizeBytes: size });
    return;
  }
  if (Date.now() - recording.lastSizeChangedAt > STALE_THRESHOLD_MS) {
    recording.child.kill('SIGTERM');
    setTimeout(() => {
      if (activeRecordings.has(recording.channel)) {
        recording.child.kill('SIGKILL');
      }
    }, 10_000);
  }
}

function stopRecording(channelName) {
  const recording = activeRecordings.get(channelName);
  if (!recording) return;
  recording.child.kill('SIGTERM');
}

function finalizeRecording(channelName) {
  const recording = activeRecordings.get(channelName);
  if (!recording) return;

  clearInterval(recording.staleTimer);
  activeRecordings.delete(channelName);

  const messages = chatRecorder.detach(channelName);
  let srtPath = null;
  if (messages && messages.length > 0) {
    srtPath = recording.filepath.replace(/\.mkv$/, '.srt');
    try {
      writeSrt(srtPath, messages);
    } catch (err) {
      srtPath = null;
    }
  }

  const channelRow = db.prepare('SELECT id FROM channels WHERE name = ?').get(channelName);
  const destinations = channelRow
    ? db
        .prepare('SELECT * FROM channel_destinations WHERE channel_id = ? AND enabled = 1')
        .all(channelRow.id)
    : [];

  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO upload_queue
      (filepath, channel, title, destination_id, youtube_account_id, playlist_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `);
  for (const dest of destinations) {
    insert.run(
      recording.filepath,
      channelName,
      path.basename(recording.filepath, '.mkv'),
      dest.id,
      dest.youtube_account_id,
      dest.playlist_id,
      now,
      now
    );
  }

  state.setChannelState(channelName, { status: 'idle', title: null, fileSizeBytes: undefined });
  logEvent('recording_end', channelName, `Recording finished: ${path.basename(recording.filepath)}`);
}

function logEvent(eventType, channel, message) {
  db.prepare(
    'INSERT INTO event_log (event_type, channel, message, created_at) VALUES (?, ?, ?, ?)'
  ).run(eventType, channel, message, new Date().toISOString());
}

module.exports = {
  sanitizeTitle,
  buildFilename,
  startRecording,
  stopRecording,
  isRecording,
};
