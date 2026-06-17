const express = require('express');
const { getAllSettings, setSetting } = require('../config');

const router = express.Router();

const REDACTED_KEYS = new Set(['twitch_client_secret', 'admin_password_hash', 'session_secret', 'encryption_key']);

router.get('/', (req, res) => {
  const settings = getAllSettings();
  for (const key of REDACTED_KEYS) {
    if (key in settings) settings[key] = undefined;
  }
  res.json(settings);
});

router.post('/', (req, res) => {
  const updates = req.body || {};
  for (const [key, value] of Object.entries(updates)) {
    if (REDACTED_KEYS.has(key)) continue;
    setSetting(key, value);
  }
  res.json({ ok: true });
});

module.exports = router;
