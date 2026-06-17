const express = require('express');
const { db } = require('../db');
const transferWorker = require('../workers/transferWorker');

const router = express.Router();

router.get('/', (req, res) => {
  const jobs = db.prepare('SELECT * FROM transfer_jobs ORDER BY created_at DESC').all();
  res.json(jobs);
});

router.post('/', async (req, res) => {
  const { sourceAccountId, sourcePlaylistId, destAccountId, destPlaylistId } = req.body || {};
  if (!sourceAccountId || !destAccountId) {
    return res.status(400).json({ error: 'sourceAccountId and destAccountId are required' });
  }
  try {
    const jobId = await transferWorker.createJob({
      sourceAccountId,
      sourcePlaylistId,
      destAccountId,
      destPlaylistId,
    });
    const job = db.prepare('SELECT * FROM transfer_jobs WHERE id = ?').get(jobId);
    res.status(201).json(job);
  } catch (err) {
    res.status(500).json({ error: 'Could not create transfer job: ' + err.message });
  }
});

router.post('/:id/pause', (req, res) => {
  transferWorker.pause(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/resume', (req, res) => {
  transferWorker.resume(req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  transferWorker.cancel(req.params.id);
  res.status(204).end();
});

module.exports = router;
