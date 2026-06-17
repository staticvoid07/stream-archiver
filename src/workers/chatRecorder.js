const tmi = require('tmi.js');

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

  client.on('message', (channel, tags, text, self) => {
    if (self) return;
    const username = tags['display-name'] || tags.username || 'unknown';
    messages.push({
      timestampMs: Date.now() - startTime.getTime(),
      username,
      text,
    });
  });

  client.connect().catch(() => {
    // tmi.js's reconnect option will retry; nothing to do on the initial failure.
  });
}

function detach(channelName) {
  const session = sessions.get(channelName);
  if (!session) return [];
  sessions.delete(channelName);
  session.client.disconnect().catch(() => {});
  return session.messages;
}

module.exports = { attach, detach };
