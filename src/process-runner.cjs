'use strict';
const { spawn } = require('node:child_process');

function runBounded(command, args, options = {}) {
  const { timeoutMs = 180000, killAfterMs = 10000, signal, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error('Execucao cancelada'));
    const child = spawn(command, args, spawnOptions);
    let timedOut = false;
    let killTimer;
    const stop = () => {
      if (killTimer) return;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), killAfterMs);
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    const cleanup = () => {
      clearTimeout(timer); clearTimeout(killTimer);
      signal?.removeEventListener('abort', stop);
    };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('exit', (code, exitSignal) => {
      cleanup();
      if (timedOut) reject(Error('Tempo limite do processo excedido; consultar estado antes de reenviar'));
      else if (signal?.aborted) reject(Error('Execucao cancelada'));
      else if (code !== 0) reject(Error(`Processo terminou: codigo=${code}, sinal=${exitSignal}`));
      else resolve();
    });
  });
}
module.exports = { runBounded };
