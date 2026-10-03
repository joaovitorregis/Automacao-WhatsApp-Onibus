'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../src/lib.cjs');
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const revision = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validateChanges(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Configuração inválida.');
  const result = {};
  for (const key of Object.keys(input)) {
    if (!['studentLines', 'productionGroup', 'testGroup', 'pausedDates', 'schedule'].includes(key)) throw Error('Campo não permitido.');
    if (key === 'studentLines') {
      if (!Array.isArray(input[key]) || input[key].length < 1 || input[key].length > 40 || input[key].some(x => typeof x !== 'string' || !x.trim() || x.length > 250 || /[\r\n\x00]/.test(x))) throw Error('Informe de 1 a 40 linhas válidas para a lista.');
      result[key] = input[key].map(x => x.trim());
    } else if (['productionGroup', 'testGroup'].includes(key)) {
      if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 120 || /[\r\n\x00]/.test(input[key])) throw Error('Nome de grupo inválido.');
      result[key] = input[key].trim();
    } else if (key === 'pausedDates') {
      if (!Array.isArray(input[key]) || input[key].length > 730 || input[key].some(x => !/^\d{4}-\d{2}-\d{2}$/.test(x) || !Number.isFinite(Date.parse(x)) || new Date(x).toISOString().slice(0, 10) !== x)) throw Error('Data de pausa inválida.');
      result[key] = [...new Set(input[key])].sort();
    } else {
      const s = input[key];
      if (!s || !Array.isArray(s.weekdays) || s.weekdays.length < 1 || s.weekdays.length > 7 || s.weekdays.some(x => !days.includes(x)) || !Number.isInteger(s.hour) || s.hour < 0 || s.hour > 23 || !Number.isInteger(s.minute) || s.minute < 0 || s.minute > 59 || !Number.isInteger(s.graceMinutes) || s.graceMinutes < 0 || s.graceMinutes > 60) throw Error('Horário ou dias inválidos.');
      result[key] = { weekdays: [...new Set(s.weekdays)], hour: s.hour, minute: s.minute, graceMinutes: s.graceMinutes };
    }
  }
  return result;
}
function durableWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  if (process.platform !== 'win32') {
    const dir = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  }
}
function nextRun(config, now = new Date()) {
  if (!config.sendingEnabled) return null;
  const date = lib.getDateKey(config, now);
  for (let i = 0; i < 740; i++) {
    const day = new Date(Date.parse(date + 'T00:00:00Z') + i * 86400000);
    const key = day.toISOString().slice(0, 10);
    // This installation uses the fixed Fortaleza offset (-03:00).
    const candidate = new Date(`${key}T${String(config.schedule.hour).padStart(2, '0')}:${String(config.schedule.minute).padStart(2, '0')}:00-03:00`);
    if (candidate > now && config.schedule.weekdays.includes(days[day.getUTCDay()]) && !config.pausedDates.includes(key)) return candidate.toISOString();
  }
  return null;
}
function tailJson(file, limit = 80) {
  if (!fs.existsSync(file)) return [];
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const buffer = Buffer.alloc(Math.min(size, 128 * 1024));
    fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length);
    return buffer.toString('utf8').split('\n').slice(-limit - 1).flatMap(line => {
      try { const e = JSON.parse(line); return [{ timestamp: e.timestamp, event: e.event, messageId: e.messageId, group: e.group, error: typeof e.error === 'string' ? e.error.slice(0, 300) : undefined }]; } catch { return []; }
    });
  } finally { fs.closeSync(fd); }
}
module.exports = { revision, validateChanges, durableWrite, nextRun, tailJson };
