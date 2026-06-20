const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { db } = require('../db');
const { encrypt, decrypt } = require('./crypto');

const CONFIG_DIR = process.env.CONFIG_DIR || './config';
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

function loadClientSecrets() {
  const filePath = path.join(CONFIG_DIR, 'client_secrets.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const creds = raw.web || raw.installed;
  if (!creds) {
    throw new Error('client_secrets.json is missing a "web" or "installed" credentials block');
  }
  return creds;
}

function buildOAuthClient(redirectUri) {
  const creds = loadClientSecrets();
  return new google.auth.OAuth2(creds.client_id, creds.client_secret, redirectUri);
}

function getAuthUrl(redirectUri) {
  const client = buildOAuthClient(redirectUri);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

async function handleCallback(code, redirectUri) {
  const client = buildOAuthClient(redirectUri);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const youtube = google.youtube({ version: 'v3', auth: client });
  const channelsRes = await youtube.channels.list({ mine: true, part: ['snippet'] });
  const channel = channelsRes.data.items && channelsRes.data.items[0];
  const channelName = channel ? channel.snippet.title : null;

  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  let email = null;
  try {
    const userInfo = await oauth2.userinfo.get();
    email = userInfo.data.email;
  } catch (err) {
    // Email scope may not be granted; channel name alone is enough to identify the account.
  }

  const encryptedTokens = encrypt(tokens);
  const result = db
    .prepare('INSERT INTO youtube_accounts (email, channel_name, tokens) VALUES (?, ?, ?)')
    .run(email, channelName, encryptedTokens);

  return db.prepare('SELECT id, email, channel_name FROM youtube_accounts WHERE id = ?').get(result.lastInsertRowid);
}

function getAuthedClient(accountId, redirectUri) {
  const account = db.prepare('SELECT * FROM youtube_accounts WHERE id = ?').get(accountId);
  if (!account) {
    throw new Error(`YouTube account ${accountId} not found`);
  }
  const tokens = decrypt(account.tokens);
  const client = buildOAuthClient(redirectUri);
  client.setCredentials(tokens);

  client.on('tokens', (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    db.prepare('UPDATE youtube_accounts SET tokens = ? WHERE id = ?').run(encrypt(merged), accountId);
  });

  return client;
}

module.exports = { getAuthUrl, handleCallback, getAuthedClient };
