const express = require('express');
const { db } = require('../db');
const uploader = require('../workers/uploader');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM upload_queue ORDER BY created_at').all();
  res.json(rows);
});

router.post('/retry/:id', (req, res) => {
  const ok = uploader.retry(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Queue item not found' });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM upload_queue WHERE id = ?').run(req.params.id);
  uploader.refreshQueueSnapshot();
  res.status(204).end();
});

router.post('/clear', (req, res) => {
  const result = db.prepare("DELETE FROM upload_queue WHERE status IN ('done', 'error')").run();
  uploader.refreshQueueSnapshot();
  res.json({ cleared: result.changes });
});

module.exports = router;
