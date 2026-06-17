const express = require('express');
const state = require('../state');

const router = express.Router();
const HEARTBEAT_MS = 25_000;

router.get('/', (req, res) => {
  res.json(state.toJSON());
});

router.get('/stream', (req, res) => {
  req.socket.setTimeout(0);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(`event: status\ndata: ${JSON.stringify(state.toJSON())}\n\n`);

  const onChange = (patch) => {
    res.write(`event: status\ndata: ${JSON.stringify(patch)}\n\n`);
  };
  state.on('change', onChange);

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    state.off('change', onChange);
  });
});

module.exports = router;
