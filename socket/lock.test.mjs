import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireLock } from './lock.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
test('recuperacao exige guarda, PID morto e conteudo valido', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-lock-'));
  const file = path.join(dir, 'lock');
  try {
    fs.writeFileSync(file, '12345');
    assert.throws(() => acquireLock(file, false));
    assert.throws(() => acquireLock(file, true, () => {}), /em curso/);
    assert.throws(() => acquireLock(file, true, () => { throw Object.assign(Error('denied'), { code: 'EPERM' }); }));
    assert.equal(fs.readFileSync(file, 'utf8'), '12345');
    const fd = acquireLock(file, true, () => { throw Object.assign(Error('dead'), { code: 'ESRCH' }); });
    fs.closeSync(fd);
    assert.equal(Number(fs.readFileSync(file)), process.pid);
    fs.writeFileSync(file, 'corrupt');
    assert.throws(() => acquireLock(file, true), /invalido/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('kernel exclui concorrente e libera apos SIGKILL real', { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-kernel-'));
  const guard = path.join(dir, 'guard');
  const lock = path.join(dir, 'lock');
  const code = `import { acquireLock } from ${JSON.stringify(new URL('./lock.mjs', import.meta.url).href)}; acquireLock(${JSON.stringify(lock)}, true); console.log('ready'); setInterval(()=>{},1000);`;
  const child = spawn('flock', ['-n', '-F', guard, process.execPath, '--input-type=module', '-e', code]);
  const exited = once(child, 'exit');
  try {
    await Promise.race([once(child.stdout, 'data'), exited.then(() => { throw Error('Processo encerrou antes de adquirir lock'); })]);
    const contender = spawnSync('flock', ['-n', '-F', guard, process.execPath, '-e', 'process.exit(0)']);
    assert.equal(contender.status, 1);
    const previousPid = Number(fs.readFileSync(lock));
    child.kill('SIGKILL');
    await exited;
    const replacement = spawnSync('flock', ['-n', '-F', guard, process.execPath, '--input-type=module', '-e', `import { acquireLock } from ${JSON.stringify(new URL('./lock.mjs', import.meta.url).href)}; acquireLock(${JSON.stringify(lock)}, true);`], { encoding: 'utf8', timeout: 5000 });
    assert.equal(replacement.status, 0, replacement.stderr);
    assert.notEqual(Number(fs.readFileSync(lock)), previousPid);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
