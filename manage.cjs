'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const base = __dirname;
const files = ['config.json', 'package.json', 'package-lock.json', 'run.sh', 'README.md', 'manage.cjs', 'scheduler.cjs',
  'recover.sh', 'socket/run.sh', 'socket/lock.mjs', 'socket/lock.test.mjs',
  'src/process-runner.cjs', 'test/process-runner.test.cjs', 'src/health.cjs', 'test/health.test.cjs',
  'scripts/recovery-snapshot.cjs', 'test/recovery-snapshot.test.cjs', 'docs/backup.md', 'docs/validacao-recuperacao.md',
  'src/automation.cjs', 'src/lib.cjs', 'src/confirmation.cjs', 'src/ack-reader.cjs', 'src/native-client.cjs',
  'test/lib.test.cjs', 'test/confirmation.test.cjs', 'test/ack-reader.test.cjs',
  'service.cjs', 'supervised-run.sh', 'socket/package.json', 'socket/package-lock.json', 'socket/auth.mjs',
  'socket/auth-store.mjs', 'socket/test-send.mjs', 'socket/policy.mjs',
  'socket/groups.mjs', 'socket/groups.test.mjs',
  'socket/mode.mjs', 'socket/mode.test.mjs',
  'socket/auth-store.test.mjs', 'socket/policy.test.mjs', 'socket/send.test.mjs'];
const json = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const legacyOptional = new Set(['src/native-client.cjs', 'src/health.cjs', 'test/health.test.cjs',
  'socket/groups.mjs', 'socket/groups.test.mjs',
  'socket/mode.mjs', 'socket/mode.test.mjs',
  'scripts/recovery-snapshot.cjs', 'test/recovery-snapshot.test.cjs', 'docs/backup.md', 'docs/validacao-recuperacao.md']);
function versionPath(folder, version) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(version || '')) throw Error('Identificador de versao invalido');
  return path.join(base, folder, version);
}
function copySet(from, to) {
  for (const file of files) {
    if (legacyOptional.has(file) && !fs.existsSync(path.join(from, file))) continue;
    const target = path.join(to, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(from, file), target);
  }
}
function lock(callback) {
  fs.mkdirSync(path.join(base, 'runtime'), { recursive: true });
  const file = path.join(base, 'runtime/automation.lock');
  const fd = fs.openSync(file, 'wx');
  fs.writeFileSync(fd, `${process.pid}\n`);
  try { return callback(); } finally { fs.closeSync(fd); fs.unlinkSync(file); }
}
function assertDisabled(root) {
  if (json(path.join(root, 'config.json')).sendingEnabled !== false) throw Error('Publicacao exige envios desativados, local e remoto');
}
function main() {
  const [action, version] = process.argv.slice(2);
  if (action === 'status') {
    const config = json(path.join(base, 'config.json'));
    const lockFile = path.join(base, 'runtime/automation.lock');
    let processRunning = false;
    if (fs.existsSync(lockFile)) {
      const pid = Number(fs.readFileSync(lockFile, 'utf8').split('\n')[0]);
      if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); processRunning = true; } catch {} }
    }
    console.log(JSON.stringify({ sendingEnabled: config.sendingEnabled, configuredSchedule: config.schedule,
      schedulerLockExists: fs.existsSync(path.join(base, 'runtime/scheduler.lock')),
      timezone: config.timezone, processRunning, lockExists: fs.existsSync(lockFile),
      backups: fs.existsSync(path.join(base, 'backups')) ? fs.readdirSync(path.join(base, 'backups')).sort() : [] }, null, 2));
    return;
  }
  if (!['publish', 'rollback'].includes(action)) throw Error('Use status, publish ID ou rollback ID');
  const source = versionPath(action === 'publish' ? '.incoming' : 'backups', version);
  for (const file of files) {
    if (action === 'rollback' && legacyOptional.has(file) && !fs.existsSync(path.join(source, file))) continue;
    if (!fs.statSync(path.join(source, file)).isFile()) throw Error(`Arquivo ausente: ${file}`);
  }
  assertDisabled(source);
  if (fs.readFileSync(path.join(source, 'service.cjs'), 'utf8').includes('./src/health.cjs') && !fs.existsSync(path.join(source, 'src/health.cjs'))) throw Error('Modulo de saude exigido pela versao candidata esta ausente');
  if(fs.readFileSync(path.join(source,'socket/auth.mjs'),'utf8').includes('./groups.mjs') && !fs.existsSync(path.join(source,'socket/groups.mjs'))) throw Error('Modulo de grupos exigido pela versao candidata esta ausente');
  if(fs.readFileSync(path.join(source,'socket/auth.mjs'),'utf8').includes('./mode.mjs') && !fs.existsSync(path.join(source,'socket/mode.mjs'))) throw Error('Modulo de modos exigido pela versao candidata esta ausente');
  assertDisabled(base);
  if (hash(path.join(source, 'package-lock.json')) !== hash(path.join(base, 'package-lock.json'))) {
    throw Error('Dependencias mudaram: instalacao controlada de dependencias necessaria antes de publicar');
  }
  if (hash(path.join(source, 'socket/package-lock.json')) !== hash(path.join(base, 'socket/package-lock.json'))) throw Error('Dependencias socket mudaram: instalacao controlada necessaria');
  const modules = path.join(source, 'socket/node_modules');
  if (!fs.existsSync(modules)) fs.symlinkSync(path.join(base, 'socket/node_modules'), modules, 'dir');
  const test = spawnSync(process.execPath, ['--test', ...files.filter(f => (f.endsWith('.test.cjs') || f.endsWith('.test.mjs')) && fs.existsSync(path.join(source, f)))], { cwd: source, stdio: 'inherit', timeout: 60000 });
  if (test.status !== 0) throw Error('Testes da versao candidata falharam; instalacao atual preservada');
  lock(() => {
    assertDisabled(base);
    const backupId = `before-${Date.now()}`;
    const backup = versionPath('backups', backupId);
    copySet(base, backup);
    try { copySet(source, base); } catch (error) { copySet(backup, base); throw error; }
    console.log(JSON.stringify({ updated: true, source: version, backup: backupId, sendingEnabled: false }));
  });
}
try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
