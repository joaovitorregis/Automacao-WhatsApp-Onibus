'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const root = __dirname;
const action = process.argv[2] || 'status';
const configPath = path.join(root, 'config.json');
const lock = path.join(root, 'runtime/scheduler.lock');
const services = path.join(root, 'runtime/services');
const supervised = path.join(services, 'whatsapp');
fs.mkdirSync(path.dirname(lock), { recursive: true });
function running() {
  if (!fs.existsSync(lock)) return false;
  const pid = Number(fs.readFileSync(lock, 'utf8'));
  if (!Number.isInteger(pid) || pid < 2) throw Error('PID invalido; inspecione o bloqueio.');
  try {
    process.kill(pid, 0);
    const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    return args.includes(path.join(root, 'scheduler.cjs'));
  }
  catch (e) { if (!['ESRCH', 'ENOENT'].includes(e.code)) throw e; return false; }
}
function setEnabled(value) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.sendingEnabled = value;
  fs.writeFileSync(configPath + '.tmp', JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(configPath + '.tmp', configPath);
}
(async () => {
  if (action === 'disable') setEnabled(false);
  else if (action === 'enable' || action === 'start') {
    if (action === 'enable') setEnabled(true);
    fs.mkdirSync(supervised, { recursive: true });
    fs.copyFileSync(path.join(root, 'supervised-run.sh'), path.join(supervised, 'run'));
    fs.chmodSync(path.join(supervised, 'run'), 0o700);
    const before = spawnSync('sv', ['status', supervised], { encoding: 'utf8' });
    if (before.status !== 0 && !before.stdout?.startsWith('down:')) {
      const log = fs.openSync(path.join(root, 'runtime/scheduler.log'), 'a');
      const child = spawn('runsvdir', [services], {
        cwd: root, detached: true, stdio: ['ignore', log, log]
      });
      child.unref();
      child.on('error', error => { console.error(error.message); process.exitCode = 1; });
      fs.closeSync(log);
    }
    const hbFile = path.join(root, 'runtime/heartbeat.json');
    if (running() && fs.existsSync(hbFile)) {
      const hb = JSON.parse(fs.readFileSync(hbFile, 'utf8'));
      const age = Date.now() - Date.parse(hb.timestamp);
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      if (hb.pid === pid && Number.isFinite(age) && age > 240000) {
        console.log(JSON.stringify({ event: 'stalled_scheduler_recovery', pid, heartbeatAgeSeconds: Math.round(age / 1000) }));
        const restarted = spawnSync('sv', ['-w', '10', 'force-restart', supervised], { encoding: 'utf8', timeout: 20000 });
        if (restarted.status !== 0) throw Error('Nao foi possivel recuperar executor travado: ' + restarted.stdout);
      }
    }
    for (let attempt = 0; attempt < 20 && !running(); attempt++) await new Promise(resolve => setTimeout(resolve, 500));
    if (!running()) { setEnabled(false); throw Error('Executor supervisionado nao iniciou; envios desativados.'); }
  } else if (action !== 'status') throw Error('Acao invalida');
  const supervision = spawnSync('sv', ['status', supervised], { encoding: 'utf8' });
  const heartbeatFile = path.join(root, 'runtime/heartbeat.json');
  const heartbeat = fs.existsSync(heartbeatFile) ? JSON.parse(fs.readFileSync(heartbeatFile, 'utf8')) : null;
  const schedulerRunning = running();
  const heartbeatAgeSeconds = heartbeat ? Math.round((Date.now() - Date.parse(heartbeat.timestamp)) / 1000) : null;
  const healthy = schedulerRunning && Number.isFinite(heartbeatAgeSeconds) && heartbeatAgeSeconds >= 0 && heartbeatAgeSeconds < 240 && supervision.status === 0;
  console.log(JSON.stringify({ sendingEnabled: JSON.parse(fs.readFileSync(configPath, 'utf8')).sendingEnabled, schedulerRunning, healthy, heartbeatAgeSeconds, supervisor: supervision.stdout?.trim() || 'unavailable', heartbeat }));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
