const { EventEmitter } = require('events');

class ArchiverState extends EventEmitter {
  constructor() {
    super();
    this.channels = new Map();
    this.queue = [];
    this.transfers = new Map();
    this.system = { diskUsage: null, uptime: 0, version: require('../package.json').version };
  }

  setChannelState(name, patch) {
    const current = this.channels.get(name) || {};
    const next = { ...current, ...patch };
    this.channels.set(name, next);
    this.emit('change', { scope: 'channel', key: name, data: next });
  }

  setQueueSnapshot(rows) {
    this.queue = rows;
    this.emit('change', { scope: 'queue', key: null, data: rows });
  }

  setTransferState(jobId, patch) {
    const current = this.transfers.get(jobId) || {};
    const next = { ...current, ...patch };
    this.transfers.set(jobId, next);
    this.emit('change', { scope: 'transfer', key: jobId, data: next });
  }

  removeTransfer(jobId) {
    this.transfers.delete(jobId);
    this.emit('change', { scope: 'transfer', key: jobId, data: null });
  }

  setSystemInfo(patch) {
    this.system = { ...this.system, ...patch };
    this.emit('change', { scope: 'system', key: null, data: this.system });
  }

  toJSON() {
    return {
      channels: Object.fromEntries(this.channels),
      queue: this.queue,
      transfers: Object.fromEntries(this.transfers),
      system: this.system,
    };
  }
}

module.exports = new ArchiverState();
