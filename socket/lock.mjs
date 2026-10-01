import fs from 'node:fs';
// Caller must hold the kernel lock for its entire lifetime before recovering.
export function acquireLock(file, recover = false, probe = pid => process.kill(pid, 0)) {
  if (recover && fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    const pid = Number(content.trim());
    if (!Number.isSafeInteger(pid) || pid < 2) throw Error('Lock invalido; revisao manual necessaria');
    try { probe(pid); throw Error('Operacao em curso; lock preservado'); }
    catch (error) {
      if (error.code !== 'ESRCH') throw error;
      if (fs.readFileSync(file, 'utf8') !== content) throw Error('Lock mudou; recuperacao recusada');
      fs.unlinkSync(file);
    }
  }
  const fd = fs.openSync(file, 'wx', 0o600);
  fs.writeFileSync(fd, `${process.pid}\n`);
  return fd;
}
