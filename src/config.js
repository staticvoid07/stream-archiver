const { db } = require('./db');

let getStmt, setStmt, allStmt;

function statements() {
  if (!getStmt) {
    getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    setStmt = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    allStmt = db.prepare('SELECT key, value FROM settings');
  }
  return { getStmt, setStmt, allStmt };
}

function getSetting(key, defaultValue = undefined) {
  const row = statements().getStmt.get(key);
  if (!row) return defaultValue;
  return JSON.parse(row.value);
}

function setSetting(key, value) {
  statements().setStmt.run(key, JSON.stringify(value));
}

function getAllSettings() {
  const rows = statements().allStmt.all();
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
