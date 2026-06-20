const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || './data';

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'archiver.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      quality TEXT,
      check_interval INTEGER,
      enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS youtube_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT,
      channel_name TEXT,
      youtube_channel_id TEXT,
      tokens TEXT
    );

    CREATE TABLE IF NOT EXISTS channel_destinations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      youtube_account_id INTEGER NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
      playlist_id TEXT,
      label TEXT,
      privacy TEXT DEFAULT 'unlisted',
      enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS upload_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filepath TEXT NOT NULL,
      destination_id INTEGER REFERENCES channel_destinations(id),
      youtube_video_id TEXT,
      uploaded_at TEXT,
      channel TEXT,
      UNIQUE(filepath, destination_id)
    );

    CREATE TABLE IF NOT EXISTS upload_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filepath TEXT NOT NULL,
      channel TEXT,
      title TEXT,
      destination_id INTEGER NOT NULL REFERENCES channel_destinations(id),
      youtube_account_id INTEGER NOT NULL REFERENCES youtube_accounts(id),
      playlist_id TEXT,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      progress REAL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS transfer_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_account_id INTEGER REFERENCES youtube_accounts(id),
      source_playlist_id TEXT,
      dest_account_id INTEGER REFERENCES youtube_accounts(id),
      dest_playlist_id TEXT,
      privacy TEXT DEFAULT 'unlisted',
      total_videos INTEGER DEFAULT 0,
      done_videos INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS transfer_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER REFERENCES transfer_jobs(id),
      source_video_id TEXT NOT NULL,
      title TEXT,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      dest_video_id TEXT
    );

    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT,
      channel TEXT,
      message TEXT,
      created_at TEXT
    );
  `);

  const transferJobsColumns = db.prepare('PRAGMA table_info(transfer_jobs)').all().map((c) => c.name);
  if (!transferJobsColumns.includes('privacy')) {
    db.exec("ALTER TABLE transfer_jobs ADD COLUMN privacy TEXT DEFAULT 'unlisted'");
  }

  const youtubeAccountsColumns = db.prepare('PRAGMA table_info(youtube_accounts)').all().map((c) => c.name);
  if (!youtubeAccountsColumns.includes('youtube_channel_id')) {
    db.exec('ALTER TABLE youtube_accounts ADD COLUMN youtube_channel_id TEXT');
  }
}

module.exports = { db, migrate };
