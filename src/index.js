require('dotenv').config();
const path = require('path');
const express = require('express');
const { migrate } = require('./db');
const { sessionMiddleware, requireSetup, requireAuth, isPublicPath } = require('./auth');
const authApi = require('./api/auth');
const setupApi = require('./api/setup');
const channelsApi = require('./api/channels');
const statusApi = require('./api/status');
const monitor = require('./workers/monitor');
const uploader = require('./workers/uploader');
const youtubeApi = require('./api/youtube');
const queueApi = require('./api/queue');
const configApi = require('./api/config');

migrate();

const app = express();
const PORT = process.env.PORT || 7373;

app.use(express.json());
app.use(sessionMiddleware());
app.use('/assets', express.static(path.join(__dirname, 'ui', 'assets')));

app.use(requireSetup);

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'ui', 'login.html')));
app.get('/setup', (req, res) => res.sendFile(path.join(__dirname, 'ui', 'setup.html')));

app.use('/api/auth', authApi);
app.use('/api/setup', setupApi);

app.use((req, res, next) => {
  if (isPublicPath(req.path)) return next();
  return requireAuth(req, res, next);
});

app.use('/api/channels', channelsApi);
app.use('/api/status', statusApi);
app.use('/api/youtube', youtubeApi);
app.use('/api/queue', queueApi);
app.use('/api/config', configApi);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'ui', 'index.html')));

app.locals.startWorkers = function startWorkers() {
  if (app.locals.workersStarted) return;
  app.locals.workersStarted = true;
  monitor.startAllMonitors();
  uploader.start();
};

if (require('./config').isSetupComplete()) {
  app.locals.startWorkers();
}

app.listen(PORT, () => {
  console.log(`Stream Archiver listening on port ${PORT}`);
});
