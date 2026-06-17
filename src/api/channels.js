const express = require('express');
const { db } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM channels ORDER BY name').all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { name, quality, checkInterval, enabled } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    const result = db
      .prepare('INSERT INTO channels (name, quality, check_interval, enabled) VALUES (?, ?, ?, ?)')
      .run(name, quality || 'best', checkInterval || 60, enabled === false ? 0 : 1);
    const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    res.status(409).json({ error: 'Channel already exists' });
  }
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  const { quality, checkInterval, enabled } = req.body || {};
  db.prepare(
    'UPDATE channels SET quality = ?, check_interval = ?, enabled = ? WHERE id = ?'
  ).run(
    quality ?? existing.quality,
    checkInterval ?? existing.check_interval,
    enabled === undefined ? existing.enabled : enabled ? 1 : 0,
    req.params.id
  );
  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  res.json(row);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM channels WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

router.get('/:id/destinations', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM channel_destinations WHERE channel_id = ?')
    .all(req.params.id);
  res.json(rows);
});

router.post('/:id/destinations', (req, res) => {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  const { youtubeAccountId, playlistId, label, privacy, enabled } = req.body || {};
  if (!youtubeAccountId) {
    return res.status(400).json({ error: 'youtubeAccountId is required' });
  }
  const result = db
    .prepare(
      `INSERT INTO channel_destinations
        (channel_id, youtube_account_id, playlist_id, label, privacy, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.params.id,
      youtubeAccountId,
      playlistId || null,
      label || null,
      privacy || 'unlisted',
      enabled === false ? 0 : 1
    );
  const row = db
    .prepare('SELECT * FROM channel_destinations WHERE id = ?')
    .get(result.lastInsertRowid);
  res.status(201).json(row);
});

router.put('/:id/destinations/:destId', (req, res) => {
  const existing = db
    .prepare('SELECT * FROM channel_destinations WHERE id = ? AND channel_id = ?')
    .get(req.params.destId, req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Destination not found' });
  }
  const { youtubeAccountId, playlistId, label, privacy, enabled } = req.body || {};
  db.prepare(
    `UPDATE channel_destinations
       SET youtube_account_id = ?, playlist_id = ?, label = ?, privacy = ?, enabled = ?
     WHERE id = ?`
  ).run(
    youtubeAccountId ?? existing.youtube_account_id,
    playlistId === undefined ? existing.playlist_id : playlistId,
    label === undefined ? existing.label : label,
    privacy ?? existing.privacy,
    enabled === undefined ? existing.enabled : enabled ? 1 : 0,
    req.params.destId
  );
  const row = db
    .prepare('SELECT * FROM channel_destinations WHERE id = ?')
    .get(req.params.destId);
  res.json(row);
});

router.delete('/:id/destinations/:destId', (req, res) => {
  db.prepare('DELETE FROM channel_destinations WHERE id = ? AND channel_id = ?').run(
    req.params.destId,
    req.params.id
  );
  res.status(204).end();
});

module.exports = router;
