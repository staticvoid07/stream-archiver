const session = require('express-session');
const bcrypt = require('bcrypt');
const { getSetting, setSetting, isSetupComplete } = require('./config');
const { getOrCreateKey } = require('./services/crypto');

function sessionMiddleware() {
  const secret = getOrCreateKey('session_secret').toString('hex');
  return session({
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  });
}

function requireSetup(req, res, next) {
  if (isSetupComplete()) return next();
  if (req.path.startsWith('/setup') || req.path.startsWith('/api/setup')) return next();
  if (req.path.startsWith('/assets')) return next();
  if (req.path === '/setup' || req.path === '/') {
    return res.redirect('/setup');
  }
  if (req.path.startsWith('/api/')) {
    return res.status(503).json({ error: 'Setup not complete' });
  }
  return res.redirect('/setup');
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/login');
}

const PUBLIC_PATHS = ['/login', '/setup', '/api/auth/login', '/api/setup'];

function isPublicPath(p) {
  return PUBLIC_PATHS.some((prefix) => p === prefix || p.startsWith(prefix + '/') || p.startsWith(prefix));
}

async function login(req, res) {
  const { username, password } = req.body || {};
  const storedUsername = getSetting('admin_username');
  const storedHash = getSetting('admin_password_hash');
  if (!storedUsername || !storedHash) {
    return res.status(503).json({ error: 'Setup not complete' });
  }
  if (username !== storedUsername) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const valid = await bcrypt.compare(password || '', storedHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.authenticated = true;
  res.json({ ok: true });
}

function logout(req, res) {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
}

module.exports = {
  sessionMiddleware,
  requireSetup,
  requireAuth,
  isPublicPath,
  login,
  logout,
};
