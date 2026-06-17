# Stream Archiver — Rewrite Spec

## Overview

A full rewrite of the current Python stream archiver as a Node.js application. The system runs on a VPS (port 7373) and is controlled entirely through a web UI accessible from any browser. The UI is password-protected. All existing functionality is preserved and new features are added.

---

## Stack

- **Runtime:** Node.js 20+ (LTS)
- **Backend framework:** Express
- **Database:** SQLite via `better-sqlite3` (replaces JSON files for history, queue state, config)
- **Frontend:** Plain HTML/CSS/JS or lightweight framework (e.g. Alpine.js + Tailwind via CDN) — no build step required
- **Auth:** Session-based with `express-session` + `bcrypt` for password hashing; single admin user
- **Real-time UI updates:** Server-Sent Events (SSE)
- **Process management:** Child processes via Node.js `child_process` (for streamlink/ffmpeg)
- **YouTube API:** `googleapis` npm package
- **Containerization:** Docker + Docker Compose
- **Port:** 7373 (externally accessible, behind the UI login)

---

## Repository Structure

```
/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
├── src/
│   ├── index.js                  # Entry point — starts Express + all workers
│   ├── config.js                 # Loads and validates config from SQLite settings table
│   ├── db.js                     # SQLite connection + schema migrations
│   ├── auth.js                   # Session auth middleware, login/logout routes
│   ├── workers/
│   │   ├── monitor.js            # Per-channel stream monitor (polls Twitch API)
│   │   ├── recorder.js           # Manages streamlink child process per recording
│   │   ├── uploader.js           # Sequential upload queue worker
│   │   ├── chatRecorder.js       # Twitch IRC chat capture
│   │   └── subtitleWriter.js     # Converts chat messages to .srt
│   ├── services/
│   │   ├── twitchApi.js          # Twitch Helix API client with token refresh
│   │   ├── youtubeAuth.js        # OAuth 2.0 flow via browser redirect (web UI)
│   │   ├── youtubeUpload.js      # Resumable chunked upload logic
│   │   ├── youtubeTransfer.js    # Channel-to-channel video transfer module
│   │   └── notifications.js      # Discord/Slack/generic webhook dispatcher
│   ├── api/
│   │   ├── status.js             # GET /api/status — live state SSE stream
│   │   ├── config.js             # GET/POST /api/config — read/write settings
│   │   ├── queue.js              # GET /api/queue, POST /api/queue/retry/:id
│   │   ├── channels.js           # CRUD for monitored channels
│   │   ├── youtube.js            # YouTube auth routes + account management
│   │   └── transfer.js           # Channel transfer job management
│   └── ui/
│       ├── index.html            # Main dashboard
│       ├── setup.html            # First-run setup wizard
│       ├── login.html            # Login page
│       ├── config.html           # Settings editor
│       ├── transfer.html         # YouTube transfer tool
│       └── assets/               # CSS, client-side JS
```

---

## Docker Setup

### Dockerfile

- Base image: `node:20-alpine`
- Install `streamlink` via pip (or apk where available)
- Install `ffmpeg` via apk
- Copy source, run `npm ci --production`
- Expose port 7373
- Volume mounts: `/data` (recordings + DB), `/config` (OAuth tokens)

### docker-compose.yml

```yaml
services:
  archiver:
    build: .
    ports:
      - "7373:7373"
    volumes:
      - ./data:/data
      - ./config:/config
    environment:
      - DATA_DIR=/data
      - CONFIG_DIR=/config
    restart: unless-stopped
```

Single `docker compose up -d` starts the entire system. No other dependencies.

---

## First-Run Setup Wizard

When the app starts with no config in the database, it serves `setup.html` on all routes (redirect everything to `/setup`). The wizard steps through:

1. **Admin password** — set username + password (stored hashed with bcrypt)
2. **Twitch credentials** — Client ID + Client Secret (tested against the API before saving)
3. **YouTube credentials** — upload `client_secrets.json` via file input, then trigger OAuth (see below)
4. **Channels** — add one or more Twitch channels to monitor, with per-channel settings
5. **Storage** — confirm data directory and disk usage settings

After completing setup, the app restarts its workers and redirects to the main dashboard.

---

## Authentication

- Single admin user (username + password)
- Password stored as bcrypt hash in SQLite `settings` table
- `express-session` with a secret derived from a random key generated on first run (stored in DB)
- Session cookie is `httpOnly`, `sameSite: strict`
- All routes except `/login` and `/setup` require an active session
- No role system needed — single user, full access

---

## YouTube OAuth (Remote-Friendly)

The current SSH port-forwarding approach is replaced with a clean in-browser OAuth flow:

1. User goes to **Settings → YouTube Accounts** in the UI
2. Clicks "Connect Account" — server generates an OAuth authorization URL and redirects the user's browser to Google
3. Google redirects back to `http://<vps-ip>:7373/api/youtube/callback`
4. Server exchanges the code for tokens, stores them in SQLite (encrypted at rest with AES-256 using a key derived from the admin password)
5. UI shows the connected account name and email

Multiple YouTube accounts are supported (one row per account in `youtube_accounts` table). Each channel can have multiple upload destinations (account + playlist pairs), all manageable from the UI.

---

## Settings / Config UI

The web UI has a full settings page (`/config`) that reads and writes all configuration. No `.env` editing needed after initial Docker setup. Config is stored in a `settings` SQLite table (key-value with JSON values).

**Configurable items:**
- Twitch credentials (Client ID, Client Secret)
- Default recording quality
- Default upload privacy (public/unlisted/private)
- Default YouTube category
- Check interval
- Post-recording cooldown
- Webhook URL + type + which events to notify on
- Storage path and disk usage warning threshold
- Per-channel overrides (quality, check interval, list of YouTube upload destinations — each destination is an account + playlist ID pair)

Changes take effect immediately without restart (workers re-read config from DB on each cycle).

---

## Core Features (Preserved from Current Version)

### Multi-Channel Monitoring
- One async loop per configured channel (using `setInterval` or a `while(true)` + `await sleep` pattern)
- Polls Twitch Helix API to detect live status
- Starts/stops recorder based on stream state
- Respects post-recording cooldown to prevent duplicate recordings from Twitch API lag

### Recording (streamlink)
- Spawns `streamlink` as a child process per channel
- Records to `.mkv` in the configured data directory
- Filename format: `{channel}_{YYYYMMDD}_{HHMMSS}_{title}.mkv`
- File staleness detection: if file size unchanged for 5 minutes, recording is killed
- Stream liveness grace: requires 3 consecutive "offline" API responses before stopping

### Chat Capture & Subtitles
- Connects to Twitch IRC over TLS (irc.chat.twitch.tv:6697) — anonymous read-only
- Timestamps messages relative to recording start
- Groups messages within 1.5-second windows into single subtitle cards
- Outputs `.srt` file alongside the `.mkv`
- Auto-reconnects on disconnect

### Upload Queue
- Sequential FIFO queue (no parallel uploads)
- On startup, scans recording directory and enqueues any `.mkv` not fully uploaded
- When a recording finishes, one `upload_queue` row is created **per destination** for that channel — so a channel with 3 YouTube destinations generates 3 queue items for each recording
- Resumable chunked uploads (10 MB chunks) via YouTube Data API v3
- Attaches `.srt` as English captions after video upload
- Adds to the destination's configured playlist if set
- Source file is deleted only after **all** destination queue items for that recording are in `done` state
- Retry logic: failed uploads are marked with error state and can be retried individually from the UI

### Webhook Notifications
- Discord, Slack, and generic HTTP POST
- Configurable per event type: stream online, recording start/end, upload start/end/fail, error

---

## New Feature: YouTube Channel Transfer Module

A tool to copy videos from one YouTube channel/playlist to another, one at a time.

### How It Works

1. User opens the **Transfer** page in the UI
2. Selects source YouTube account + playlist (or "all videos from channel")
3. Selects destination YouTube account + destination playlist (optional)
4. Clicks "Start Transfer" — creates a transfer job in the DB

### Transfer Job Execution

- Worker iterates through source playlist videos one at a time
- For each video:
  1. Download video using `yt-dlp` (spawned as child process) to a temp file
  2. Upload temp file to destination channel using YouTube Data API
  3. Copy title, description, tags, and thumbnail from source video
  4. Add to destination playlist if configured
  5. Delete temp file
  6. Mark video as transferred in DB
- Progress visible in UI: `{done}/{total}` with current video title
- Can be paused and resumed
- Errors on individual videos are logged and skipped (with UI indicator); job continues

### Transfer UI (`/transfer`)

- List of all transfer jobs with status (pending, running, paused, done, partial)
- Create new transfer job form
- Per-job progress bar
- Per-job error log (expandable)
- Pause / Resume / Cancel buttons

---

## Dashboard UI

Main page accessible at the root after login. Shows:

- **Live channels panel:** each monitored channel with status (idle / recording / uploading), stream title if live, recording duration, file size
- **Upload queue panel:** pending uploads list with file names and sizes; current upload progress bar
- **Transfer jobs panel:** active transfers with progress
- **Recent activity log:** last N events (recording started, upload completed, etc.) pulled from DB
- **System info:** disk usage, uptime, version

Updates via SSE (`/api/status/stream`) — no polling, no page refresh needed.

---

## API Endpoints

All endpoints require authentication (session cookie). Return JSON.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Current snapshot of all state |
| GET | `/api/status/stream` | SSE stream of state changes |
| GET | `/api/channels` | List configured channels |
| POST | `/api/channels` | Add channel |
| PUT | `/api/channels/:id` | Update channel config |
| DELETE | `/api/channels/:id` | Remove channel |
| GET | `/api/queue` | Upload queue contents |
| POST | `/api/queue/retry/:id` | Retry failed upload |
| DELETE | `/api/queue/:id` | Remove item from queue |
| GET | `/api/config` | Read all settings |
| POST | `/api/config` | Write settings (batch) |
| GET | `/api/youtube/accounts` | List connected YouTube accounts |
| GET | `/api/youtube/connect` | Start OAuth flow (redirects to Google) |
| GET | `/api/youtube/callback` | OAuth callback handler |
| DELETE | `/api/youtube/accounts/:id` | Disconnect account |
| GET | `/api/channels/:id/destinations` | List upload destinations for a channel |
| POST | `/api/channels/:id/destinations` | Add a destination (account + playlist) |
| PUT | `/api/channels/:id/destinations/:destId` | Update a destination |
| DELETE | `/api/channels/:id/destinations/:destId` | Remove a destination |
| GET | `/api/transfer` | List transfer jobs |
| POST | `/api/transfer` | Create transfer job |
| POST | `/api/transfer/:id/pause` | Pause job |
| POST | `/api/transfer/:id/resume` | Resume job |
| DELETE | `/api/transfer/:id` | Cancel + delete job |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |

---

## SQLite Schema

```sql
-- Core settings (key-value)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT  -- JSON-encoded
);

-- Monitored Twitch channels
CREATE TABLE channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  quality TEXT,
  check_interval INTEGER,
  enabled INTEGER DEFAULT 1
);

-- Connected YouTube accounts
CREATE TABLE youtube_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  channel_name TEXT,
  tokens TEXT  -- AES-256 encrypted JSON
);

-- Many-to-many: each Twitch channel can upload to multiple YouTube accounts/playlists
-- Each row is one "destination" — an account + optional playlist pair
CREATE TABLE channel_destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  youtube_account_id INTEGER NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
  playlist_id TEXT,       -- optional; null means no playlist
  label TEXT,             -- optional human-readable label, e.g. "Main channel", "Clips archive"
  privacy TEXT DEFAULT 'unlisted',  -- overrides global default for this destination
  enabled INTEGER DEFAULT 1
);

-- Upload history (prevents re-uploads); keyed per file + destination
CREATE TABLE upload_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filepath TEXT NOT NULL,
  destination_id INTEGER REFERENCES channel_destinations(id),
  youtube_video_id TEXT,
  uploaded_at TEXT,
  channel TEXT,
  UNIQUE(filepath, destination_id)
);

-- Upload queue — one row per (recording file × destination)
-- A recording going to 3 YouTube destinations creates 3 rows here
CREATE TABLE upload_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filepath TEXT NOT NULL,
  channel TEXT,
  title TEXT,
  destination_id INTEGER NOT NULL REFERENCES channel_destinations(id),
  youtube_account_id INTEGER NOT NULL REFERENCES youtube_accounts(id),
  playlist_id TEXT,
  status TEXT DEFAULT 'pending',  -- pending | uploading | done | error
  error_message TEXT,
  progress REAL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

-- Transfer jobs
CREATE TABLE transfer_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_account_id INTEGER REFERENCES youtube_accounts(id),
  source_playlist_id TEXT,
  dest_account_id INTEGER REFERENCES youtube_accounts(id),
  dest_playlist_id TEXT,
  total_videos INTEGER DEFAULT 0,
  done_videos INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',  -- pending | running | paused | done | error
  created_at TEXT,
  updated_at TEXT
);

-- Transfer job video items
CREATE TABLE transfer_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES transfer_jobs(id),
  source_video_id TEXT NOT NULL,
  title TEXT,
  status TEXT DEFAULT 'pending',  -- pending | done | error | skipped
  error_message TEXT,
  dest_video_id TEXT
);

-- Event log (for dashboard activity feed)
CREATE TABLE event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT,
  channel TEXT,
  message TEXT,
  created_at TEXT
);
```

---

## Environment Variables (Docker / .env)

Only the minimum needed at container start. Everything else is configured via the UI.

```
PORT=7373
DATA_DIR=/data
CONFIG_DIR=/config
NODE_ENV=production
```

All other config (Twitch keys, YouTube secrets, channel list, etc.) lives in the SQLite DB and is managed through the UI.

---

## Key npm Dependencies

```json
{
  "express": "^4.18",
  "express-session": "^1.17",
  "better-sqlite3": "^9.0",
  "googleapis": "^140.0",
  "bcrypt": "^5.1",
  "ws": "^8.0",
  "dotenv": "^16.0",
  "uuid": "^9.0"
}
```

`yt-dlp` and `streamlink` are installed in the Docker image as system tools, not npm packages.

---

## Out of Scope for This Rewrite

- Multiple admin users / roles
- Email notifications (webhooks cover this)
- Scheduling (record only at certain times)
- Transcoding / re-encoding (pass-through only)
- Clip trimming or editing

---

## Notes for the Builder

- **Preserve all existing recording logic** exactly — the stale-file detection, the 3-consecutive-offline grace period, the cooldown timing, the filename sanitization. These were all added to fix real bugs.
- **The YouTube transfer module needs `yt-dlp`** installed in the Docker image alongside streamlink. Add it to the Dockerfile.
- **OAuth tokens must survive container restarts** — store them in SQLite (in the `/data` volume), not in memory or temp files.
- **The UI should work without a build step** — no webpack, no Vite, no TypeScript compilation. The Docker image should just run `node src/index.js`.
- **SSE over WebSocket** — SSE is simpler for one-way server→client state push. Use WebSocket only if bidirectional communication is needed (it isn't here).
- **Sequential uploads are intentional** — YouTube rate limits make parallel uploads risky. Keep the single-worker queue. The worker processes one `upload_queue` row at a time regardless of how many destinations exist.
- **Multi-destination file deletion** — a recording's source `.mkv` and `.srt` must not be deleted until every `upload_queue` row sharing that `filepath` is in `done` status. The upload worker should check this before deleting.
- **Channel destinations UI** — the channel edit form should show a list of destinations with Add / Edit / Remove controls. Each destination row shows: YouTube account (dropdown of connected accounts), playlist ID (text input), label (text input), privacy override (dropdown), enabled toggle.
- **The transfer worker and the upload worker are separate** — they run independently and do not share a queue.
- **yt-dlp for transfer downloads** — do not use the YouTube API to download; it doesn't support that. yt-dlp is the correct tool.
