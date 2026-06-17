const { db } = require('../db');
const state = require('../state');
const { listPlaylistVideos, listChannelVideos, transferOneVideo } = require('../services/youtubeTransfer');

const POLL_INTERVAL_MS = 5_000;
let running = false;

function refreshJobState(jobId) {
  const job = db.prepare('SELECT * FROM transfer_jobs WHERE id = ?').get(jobId);
  if (!job) return;
  const current = db.prepare('SELECT title FROM transfer_items WHERE job_id = ? AND status = ?').get(jobId, 'pending');
  state.setTransferState(jobId, {
    done: job.done_videos,
    total: job.total_videos,
    status: job.status,
    currentTitle: current ? current.title : null,
    currentStage: null,
    currentProgress: null,
  });
}

async function createJob({ sourceAccountId, sourcePlaylistId, destAccountId, destPlaylistId, privacy }) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO transfer_jobs
        (source_account_id, source_playlist_id, dest_account_id, dest_playlist_id, privacy, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .run(sourceAccountId, sourcePlaylistId || null, destAccountId, destPlaylistId || null, privacy || 'unlisted', now, now);
  const jobId = result.lastInsertRowid;

  const videos = sourcePlaylistId
    ? await listPlaylistVideos(sourceAccountId, sourcePlaylistId)
    : await listChannelVideos(sourceAccountId);
  // YouTube returns playlist/uploads items newest-first; reverse so the
  // transfer processes oldest videos first.
  videos.reverse();

  const insertItem = db.prepare(
    'INSERT INTO transfer_items (job_id, source_video_id, title, status) VALUES (?, ?, ?, ?)'
  );
  const tx = db.transaction((rows) => {
    for (const v of rows) insertItem.run(jobId, v.videoId, v.title, 'pending');
  });
  tx(videos);

  db.prepare('UPDATE transfer_jobs SET total_videos = ?, status = ?, updated_at = ? WHERE id = ?').run(
    videos.length,
    'running',
    new Date().toISOString(),
    jobId
  );

  refreshJobState(jobId);
  return jobId;
}

function pause(jobId) {
  db.prepare("UPDATE transfer_jobs SET status = 'paused', updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    jobId
  );
  refreshJobState(jobId);
}

function resume(jobId) {
  db.prepare("UPDATE transfer_jobs SET status = 'running', updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    jobId
  );
  refreshJobState(jobId);
}

function cancel(jobId) {
  db.prepare('DELETE FROM transfer_items WHERE job_id = ?').run(jobId);
  db.prepare('DELETE FROM transfer_jobs WHERE id = ?').run(jobId);
  state.removeTransfer(jobId);
}

function finalizeIfDone(job) {
  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('error', 'skipped') THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM transfer_items WHERE job_id = ?`
    )
    .get(job.id);
  if (counts.pending > 0) return;
  const status = counts.failed > 0 ? 'partial' : 'done';
  db.prepare('UPDATE transfer_jobs SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    new Date().toISOString(),
    job.id
  );
  refreshJobState(job.id);
}

async function processNextItem() {
  const job = db.prepare("SELECT * FROM transfer_jobs WHERE status = 'running' ORDER BY updated_at LIMIT 1").get();
  if (!job) return;

  const item = db
    .prepare("SELECT * FROM transfer_items WHERE job_id = ? AND status = 'pending' ORDER BY id LIMIT 1")
    .get(job.id);
  if (!item) {
    finalizeIfDone(job);
    return;
  }

  try {
    const destVideoId = await transferOneVideo(item, job, ({ stage, percent }) => {
      state.setTransferState(job.id, {
        done: job.done_videos,
        total: job.total_videos,
        status: job.status,
        currentTitle: item.title,
        currentStage: stage,
        currentProgress: percent,
      });
    });
    db.prepare("UPDATE transfer_items SET status = 'done', dest_video_id = ? WHERE id = ?").run(destVideoId, item.id);
    db.prepare('UPDATE transfer_jobs SET done_videos = done_videos + 1, updated_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      job.id
    );
  } catch (err) {
    db.prepare("UPDATE transfer_items SET status = 'error', error_message = ? WHERE id = ?").run(
      String(err.message || err),
      item.id
    );
  }

  refreshJobState(job.id);
}

async function tick() {
  if (running) return;
  running = true;
  try {
    await processNextItem();
  } finally {
    running = false;
  }
}

function start() {
  setInterval(tick, POLL_INTERVAL_MS);
}

module.exports = { start, createJob, pause, resume, cancel };
