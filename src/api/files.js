const express = require('express');
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const recorder = require('../workers/recorder');

const DATA_DIR = process.env.DATA_DIR || './data';
const router = express.Router();

function relatedFiles(basename) {
  return [`${basename}.mkv`, `${basename}.srt`, `${basename}.chat.jsonl`];
}

router.get('/', (req, res) => {
  let entries;
  try {
    entries = fs.readdirSync(DATA_DIR);
  } catch (err) {
    return res.json([]);
  }

  const mkvFiles = entries.filter((f) => f.endsWith('.mkv'));
  const files = mkvFiles.map((file) => {
    const basename = file.slice(0, -4);
    const filepath = path.join(DATA_DIR, file);
    let stat;
    try {
      stat = fs.statSync(filepath);
    } catch (err) {
      return null;
    }

    const hasSrt = entries.includes(`${basename}.srt`);
    const srtSize = hasSrt ? fs.statSync(path.join(DATA_DIR, `${basename}.srt`)).size : 0;

    const queueRows = db
      .prepare('SELECT status FROM upload_queue WHERE filepath = ?')
      .all(filepath);
    const channelName = file.split('_')[0];

    return {
      filename: file,
      basename,
      channel: channelName,
      sizeBytes: stat.size + srtSize,
      mtime: stat.mtime.toISOString(),
      hasSrt,
      isRecording: recorder.isFileActivelyRecording(filepath),
      queueStatuses: queueRows.map((r) => r.status),
      uploadedCount: queueRows.filter((r) => r.status === 'done').length,
      totalDestinations: queueRows.length,
    };
  }).filter(Boolean);

  files.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
  res.json(files);
});

router.delete('/:basename', (req, res) => {
  const basename = req.params.basename;
  const filepath = path.join(DATA_DIR, `${basename}.mkv`);

  if (recorder.isFileActivelyRecording(filepath)) {
    return res.status(409).json({ error: 'Cannot delete a file that is currently being recorded' });
  }

  const queueRows = db.prepare('SELECT status FROM upload_queue WHERE filepath = ?').all(filepath);
  const inProgress = queueRows.some((r) => r.status === 'uploading');
  if (inProgress) {
    return res.status(409).json({ error: 'Cannot delete a file that is currently uploading' });
  }

  for (const name of relatedFiles(basename)) {
    const p = path.join(DATA_DIR, name);
    try {
      fs.unlinkSync(p);
    } catch (err) {
      // File may not exist (e.g. no .srt); ignore.
    }
  }

  db.prepare('DELETE FROM upload_queue WHERE filepath = ?').run(filepath);

  res.status(204).end();
});

module.exports = router;
