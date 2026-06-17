const { db } = require('./db');

const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setStmt = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);
const allStmt = db.prepare('SELECT key, value FROM settings');

function getSetting(key, defaultValue = undefined) {
  const row = getStmt.get(key);
  if (!row) return defaultValue;
  return JSON.parse(row.value);
}

function setSetting(key, value) {
  setStmt.run(key, JSON.stringify(value));
}

function getAllSettings() {
  const rows = allStmt.all();
  const result = {};
  for (const row of rows) {
    result[row.key] = JSON.parse(row.value);
  }
  return result;
}

function isSetupComplete() {
  return getSetting('admin_password_hash') !== undefined;
}

module.exports = { getSetting, setSetting, getAllSettings, isSetupComplete };
