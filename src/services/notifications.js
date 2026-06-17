const { getSetting } = require('../config');
const { db } = require('../db');

function buildPayload(type, eventType, message) {
  if (type === 'discord') return { content: message };
  if (type === 'slack') return { text: message };
  return { event: eventType, message };
}

async function notify(eventType, { channel, message }) {
  try {
    const webhook = getSetting('webhook');
    const fullMessage = channel ? `[${channel}] ${message}` : message;

    if (webhook && webhook.url && Array.isArray(webhook.events) && webhook.events.includes(eventType)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        await fetch(webhook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload(webhook.type, eventType, fullMessage)),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  } catch (err) {
    db.prepare(
      'INSERT INTO event_log (event_type, channel, message, created_at) VALUES (?, ?, ?, ?)'
    ).run('notification_error', channel || null, String(err.message || err), new Date().toISOString());
  }
}

module.exports = { notify };
