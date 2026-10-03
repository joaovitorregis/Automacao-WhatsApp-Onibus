'use strict';
// Explicit maintenance test: requires disabled sending and no delivery in progress.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
if (JSON.parse(fs.readFileSync(path.join(root, 'config.json'))).sendingEnabled !== false) throw Error('Disable primeiro');
if (fs.existsSync(path.join(root, 'runtime/automation.lock'))) throw Error('Operacao em curso');
const pid = Number(fs.readFileSync(path.join(root, 'runtime/scheduler.lock')));
if (!fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').includes(path.join(root, 'scheduler.cjs'))) throw Error('PID nao corresponde');
const heartbeat = path.join(root, 'runtime/heartbeat.json');
process.kill(pid, 'SIGSTOP');
try {
  fs.writeFileSync(heartbeat, JSON.stringify({ pid, timestamp: new Date(Date.now() - 300000).toISOString() }));
  const result = spawnSync(process.execPath, [path.join(root, 'service.cjs'), 'start'], { encoding: 'utf8', timeout: 25000 });
  console.log(result.stdout);
  if (result.status !== 0) throw Error(result.stderr || 'Falha na recuperacao');
  const replacement = Number(fs.readFileSync(path.join(root, 'runtime/scheduler.lock')));
  if (replacement === pid) throw Error('Processo nao foi substituido');
  console.log(JSON.stringify({ stallRecoveryPassed: true, previousPid: pid, replacementPid: replacement }));
} finally {
  try {
    if (fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').includes(path.join(root, 'scheduler.cjs'))) process.kill(pid, 'SIGCONT');
  } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
}
