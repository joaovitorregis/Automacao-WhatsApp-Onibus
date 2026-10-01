'use strict';
// Prepared service entry point. Not started or installed automatically.
const fs = require('node:fs');
const path = require('node:path');
const { runBounded } = require('./src/process-runner.cjs');
const { validateConfig, isInsideScheduledWindow, isPausedDate, getDateKey, normalizeGroupName, writeJsonAtomic } = require('./src/lib.cjs');
const base = __dirname;
let stopping = false;
let wake;
const controller = new AbortController();
process.on('SIGTERM', () => { stopping = true; controller.abort(); wake?.(); });
process.on('SIGINT', () => { stopping = true; controller.abort(); wake?.(); });
async function tick() {
  const config = validateConfig(JSON.parse(fs.readFileSync(path.join(base, 'config.json'), 'utf8')));
  if (config.sendingEnabled !== true) return;
  const now = new Date();
  if (isPausedDate(config, now) || !isInsideScheduledWindow(config, now)) return;
  const stateFile = path.join(base, 'runtime/state.json');
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state.version !== 1 || !state.deliveries) throw Error('Estado invalido: execucao recusada');
    const key = `${getDateKey(config, now)}|${normalizeGroupName(config.productionGroup)}`;
    if (['sent', 'attempting', 'uncertain'].includes(state.deliveries[key]?.status)) return;
  }
  await runBounded('/data/data/com.termux/files/usr/bin/sh', [path.join(base, 'socket/run.sh'), '--scheduled'], {
    cwd: base, stdio: 'inherit', timeoutMs: 180000, signal: controller.signal
  });
}
(async () => {
  if (process.argv.includes('--once')) { await tick(); return; }
  fs.mkdirSync(path.join(base, 'runtime'), { recursive: true });
  const lockFile = path.join(base, 'runtime/scheduler.lock');
  if (fs.existsSync(lockFile)) {
    const oldPid = Number(fs.readFileSync(lockFile, 'utf8'));
    if (!Number.isInteger(oldPid) || oldPid < 2) throw Error('Lock invalido');
    try { process.kill(oldPid, 0); throw Error('PID do lock ainda existe; recusando segunda instancia'); }
    catch (error) {
      if (error.code !== 'ESRCH') throw error;
      fs.unlinkSync(lockFile);
      console.log(JSON.stringify({ event: 'stale_scheduler_lock_recovered', pid: oldPid, timestamp: new Date().toISOString() }));
    }
  }
  const fd = fs.openSync(lockFile, 'wx');
  fs.writeFileSync(fd, String(process.pid));
  console.log(JSON.stringify({ event: 'scheduler_started', pid: process.pid, timestamp: new Date().toISOString() }));
  try {
    while (!stopping) {
      writeJsonAtomic(path.join(base, 'runtime/heartbeat.json'), { pid: process.pid, timestamp: new Date().toISOString() });
      try { await tick(); } catch (error) { console.error(new Date().toISOString(), error.message); }
      if (!stopping) await new Promise(resolve => {
        const timer = setTimeout(resolve, 30000);
        wake = () => { clearTimeout(timer); resolve(); };
      });
    }
  } finally { fs.closeSync(fd); fs.unlinkSync(lockFile); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
