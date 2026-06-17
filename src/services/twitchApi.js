const { getSetting, setSetting } = require('../config');

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const HELIX_URL = 'https://api.twitch.tv/helix';

async function fetchAppToken(clientId, clientSecret) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });
  const res = await fetch(`${TOKEN_URL}?${params.toString()}`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Twitch token request failed: ${res.status}`);
  }
  return res.json();
}

async function getAppToken() {
  const clientId = getSetting('twitch_client_id');
  const clientSecret = getSetting('twitch_client_secret');
  if (!clientId || !clientSecret) {
    throw new Error('Twitch credentials not configured');
  }
  const cached = getSetting('twitch_app_token');
  if (cached && cached.expires_at > Date.now() + 60_000) {
    return cached.access_token;
  }
  const token = await fetchAppToken(clientId, clientSecret);
  setSetting('twitch_app_token', {
    access_token: token.access_token,
    expires_at: Date.now() + token.expires_in * 1000,
  });
  return token.access_token;
}

async function validateCredentials(clientId, clientSecret) {
  await fetchAppToken(clientId, clientSecret);
  return true;
}

async function helixGet(path, params) {
  const clientId = getSetting('twitch_client_id');
  const accessToken = await getAppToken();
  const query = new URLSearchParams(params);
  const res = await fetch(`${HELIX_URL}${path}?${query.toString()}`, {
    headers: {
      'Client-Id': clientId,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Twitch API request failed: ${res.status}`);
  }
  return res.json();
}

async function getStreams(usernames) {
  if (usernames.length === 0) return [];
  const params = new URLSearchParams();
  for (const name of usernames) params.append('user_login', name);
  const data = await helixGet('/streams', params);
  return data.data;
}

module.exports = { validateCredentials, getStreams, getAppToken };
