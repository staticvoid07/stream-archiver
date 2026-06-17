const fs = require('fs');

const WINDOW_MS = 1500;

function groupMessages(messages, windowMs = WINDOW_MS) {
  const groups = [];
  for (const msg of messages) {
    const last = groups[groups.length - 1];
    if (last && msg.timestampMs - last.startMs < windowMs) {
      last.lines.push(`${msg.username}: ${msg.text}`);
      last.endMs = msg.timestampMs;
    } else {
      groups.push({
        startMs: msg.timestampMs,
        endMs: msg.timestampMs,
        lines: [`${msg.username}: ${msg.text}`],
      });
    }
  }
  return groups;
}

function formatSrtTimestamp(ms) {
  const totalMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  const pad = (n, len) => String(n).padStart(len, '0');
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

function toSrt(groups, { minDurationMs = 1000 } = {}) {
  return groups
    .map((group, idx) => {
      const start = group.startMs;
      const end = Math.max(group.endMs + minDurationMs, start + minDurationMs);
      return [
        String(idx + 1),
        `${formatSrtTimestamp(start)} --> ${formatSrtTimestamp(end)}`,
        ...group.lines,
        '',
      ].join('\n');
    })
    .join('\n');
}

function writeSrt(filePath, messages, options) {
  const groups = groupMessages(messages, options && options.windowMs);
  const srt = toSrt(groups, options);
  fs.writeFileSync(filePath, srt, 'utf8');
  return filePath;
}

module.exports = { groupMessages, toSrt, formatSrtTimestamp, writeSrt };
