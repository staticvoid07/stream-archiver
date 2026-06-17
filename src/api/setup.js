const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const { setSetting, isSetupComplete } = require('../config');
const { validateCredentials } = require('../services/twitchApi');

const CONFIG_DIR = process.env.CONFIG_DIR || './config';
const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

router.post('/admin', async (req, res) => {
  if (isSetupComplete()) {
    return res.status(400).json({ error: 'Setup already complete' });
  }
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const hash = await bcrypt.hash(password, 12);
  setSetting('admin_username', username);
  setSetting('admin_password_hash', hash);
  res.json({ ok: true });
});

router.post('/twitch', async (req, res) => {
  const { clientId, clientSecret } = req.body || {};
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'Client ID and secret are required' });
  }
  try {
    await validateCredentials(clientId, clientSecret);
  } catch (err) {
    return res.status(400).json({ error: 'Twitch credentials could not be validated' });
  }
  setSetting('twitch_client_id', clientId);
  setSetting('twitch_client_secret', clientSecret);
  res.json({ ok: true });
});

router.post('/youtube', upload.single('client_secrets'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'client_secrets.json file is required' });
  }
  let parsed;
  try {
    parsed = JSON.parse(req.file.buffer.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'File is not valid JSON' });
  }
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(CONFIG_DIR, 'client_secrets.json'), JSON.stringify(parsed, null, 2));
  res.json({ ok: true });
});

router.post('/channels', (req, res) => {
  const { channels } = req.body || {};
  if (!Array.isArray(channels)) {
    return res.status(400).json({ error: 'channels must be an array' });
  }
  const insert = db.prepare(
    'INSERT INTO channels (name, quality, check_interval, enabled) VALUES (?, ?, ?, 1)'
  );
  const tx = db.transaction((rows) => {
    for (const ch of rows) {
      insert.run(ch.name, ch.quality || 'best', ch.checkInterval || 60);
    }
  });
  tx(channels);
  res.json({ ok: true });
});

router.post('/storage', (req, res) => {
  const { diskUsageWarningThreshold } = req.body || {};
  if (diskUsageWarningThreshold !== undefined) {
    setSetting('disk_usage_warning_threshold', diskUsageWarningThreshold);
  }
  res.json({ ok: true });
});

router.post('/complete', (req, res, next) => {
  if (!isSetupComplete()) {
    return res.status(400).json({ error: 'Admin account has not been created yet' });
  }
  setSetting('setup_completed_at', new Date().toISOString());
  if (req.app.locals.startWorkers) {
    req.app.locals.startWorkers();
  }
  res.json({ ok: true });
});

module.exports = router;
