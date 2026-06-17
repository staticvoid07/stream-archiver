const { db } = require('../db');
const { getSetting } = require('../config');
const { getStreams } = require('../services/twitchApi');
const recorder = require('./recorder');
const state = require('../state');

const OFFLINE_GRACE_POLLS = 3;

const monitors = new Map();

function getChannelRow(name) {
  return db.prepare('SELECT * FROM channels WHERE name = ?').get(name);
}

function scheduleNext(channelName, ms) {
  const monitor = monitors.get(channelName);
  if (!monitor) return;
  monitor.timer = setTimeout(() => tick(channelName), ms);
}

async function tick(channelName) {
  const monitor = monitors.get(channelName);
  if (!monitor) return;

  const channel = getChannelRow(channelName);
  if (!channel || !channel.enabled) {
    monitors.delete(channelName);
    return;
  }

  const checkInterval = (channel.check_interval || getSetting('check_interval', 60)) * 1000;

  try {
    const streams = await getStreams([channelName]);
    const live = streams[0];

    if (live) {
      monitor.offlineCount = 0;
      const inCooldown = monitor.cooldownUntil && Date.now() < monitor.cooldownUntil;
      if (!recorder.isRecording(channelName) && !inCooldown) {
        recorder.startRecording(channel, { title: live.title });
      }
      monitor.wasLive = true;
      state.setChannelState(channelName, { status: recorder.isRecording(channelName) ? 'recording' : 'idle' });
    } else {
      monitor.offlineCount += 1;
      if (monitor.offlineCount >= OFFLINE_GRACE_POLLS && recorder.isRecording(channelName)) {
        recorder.stopRecording(channelName);
        monitor.cooldownUntil = Date.now() + getSetting('post_recording_cooldown', 60) * 1000;
      }
      if (monitor.offlineCount >= OFFLINE_GRACE_POLLS) {
        monitor.wasLive = false;
      }
    }
  } catch (err) {
    // Transient API errors should not crash the monitor loop; just retry next tick.
  }

  scheduleNext(channelName, checkInterval);
}

function addChannelMonitor(channelName) {
  if (monitors.has(channelName)) return;
  monitors.set(channelName, {
    timer: null,
    offlineCount: 0,
    wasLive: false,
    cooldownUntil: 0,
  });
  tick(channelName);
}

function removeChannelMonitor(channelName) {
  const monitor = monitors.get(channelName);
  if (!monitor) return;
  clearTimeout(monitor.timer);
  monitors.delete(channelName);
}

function startAllMonitors() {
  const channels = db.prepare('SELECT * FROM channels WHERE enabled = 1').all();
  for (const channel of channels) {
    addChannelMonitor(channel.name);
  }
}

module.exports = { startAllMonitors, addChannelMonitor, removeChannelMonitor };
