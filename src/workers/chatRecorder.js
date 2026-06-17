const tmi = require('tmi.js');
const state = require('../state');

const sessions = new Map();

function attach(channelName, startTime) {
  if (sessions.has(channelName)) return;

  const client = new tmi.Client({
    options: { skipMembership: true },
    connection: { reconnect: true, secure: true },
    channels: [channelName],
  });

  const messages = [];
  const session = { client, messages, startTime };
  sessions.set(channelName, session);

  client.on('connected', () => {
    state.addEvent('chat_connected', channelName, 'Chat capture connected');
  });

  client.on('disconnected', (reason) => {
    state.addEvent('chat_disconnected', channelName, `Chat capture disconnected: ${reason}`);
  });

  client.on('message', (channel, tags, text, self) => {
    if (self) return;
    const username = tags['display-name'] || tags.username || 'unknown';
    messages.push({
      timestampMs: Date.now() - startTime.getTime(),
      username,
      text,
    });
  });

  client.connect().catch((err) => {
    state.addEvent('chat_error', channelName, `Chat capture failed to connect: ${err.message || err}`);
  });
}

function detach(channelName) {
  const session = sessions.get(channelName);
  if (!session) return [];
  sessions.delete(channelName);
  session.client.disconnect().catch(() => {});
  state.addEvent('chat_summary', channelName, `Captured ${session.messages.length} chat message(s)`);
  return session.messages;
}

module.exports = { attach, detach };
