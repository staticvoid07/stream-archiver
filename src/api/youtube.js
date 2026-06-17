const express = require('express');
const { db } = require('../db');
const { getAuthUrl, handleCallback } = require('../services/youtubeAuth');

const router = express.Router();

function callbackRedirectUri(req) {
  return `${req.protocol}://${req.get('host')}/api/youtube/callback`;
}

router.get('/accounts', (req, res) => {
  const rows = db.prepare('SELECT id, email, channel_name FROM youtube_accounts').all();
  res.json(rows);
});

router.get('/connect', (req, res) => {
  try {
    const url = getAuthUrl(callbackRedirectUri(req));
    res.redirect(url);
  } catch (err) {
    res.status(500).json({ error: 'Could not start OAuth flow: ' + err.message });
  }
});

router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Missing authorization code');
  }
  try {
    await handleCallback(code, callbackRedirectUri(req));
    res.redirect('/config');
  } catch (err) {
    res.status(500).send('OAuth callback failed: ' + err.message);
  }
});

router.delete('/accounts/:id', (req, res) => {
  db.prepare('DELETE FROM youtube_accounts WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
