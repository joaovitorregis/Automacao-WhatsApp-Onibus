import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import makeWASocket, { makeCacheableSignalKeyStore, DisconnectReason, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { openAuthStore } from './auth-store.mjs';
import { testSend } from './test-send.mjs';
import { acquireLock } from './lock.mjs';

process.umask(0o077);
const root = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(root, 'runtime');
fs.mkdirSync(runtime, { recursive: true });
const lock = path.join(root, '../runtime/automation.lock');
const fd = acquireLock(lock, process.env.WHATSAPP_KERNEL_LOCK === '1');
const logger = pino({ level: 'silent' });
const log = (event, details = {}) => {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), event, ...details });
  fs.appendFileSync(path.join(runtime, 'events.jsonl'), line + '\n');
  console.log(line);
};
let sock;
let stopping = false;
let state;
let writes = Promise.resolve();
function terminate(signal) {
  stopping = true;
  log('process_interrupted', { signal });
  sock?.end(Error('Processo interrompido'));
  // Auth-store writes are synchronous/atomic. Preserve all delivery records;
  // interrupted attempts remain blocked instead of being sent again.
  if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8').trim() === String(process.pid)) fs.unlinkSync(lock);
  process.exit(1);
}
process.on('SIGTERM', () => terminate('SIGTERM'));
process.on('SIGINT', () => terminate('SIGINT'));
const deadline = setTimeout(() => { log('auth_timeout'); sock?.end(Error('Tempo de vinculacao esgotado')); }, 10 * 60_000);
function connect() {
  return new Promise((resolve, reject) => {
    sock = makeWASocket({ auth: { creds: state.state.creds, keys: makeCacheableSignalKeyStore(state.state.keys, logger) },
      logger, browser: Browsers.ubuntu('Chrome'), markOnlineOnConnect: false,
      syncFullHistory: false, shouldSyncHistoryMessage: () => false,
      getMessage: async () => undefined, connectTimeoutMs: 30000 });
    sock.ev.on('creds.update', () => {
      writes = writes.then(state.saveCreds);
      writes.catch(reject);
    });
    sock.ev.on('connection.update', update => {
      if (update.qr) {
        if (process.argv.includes('--scheduled')) { reject(Error('Sessao desconectada: vinculacao manual necessaria')); return; }
        QRCode.toFile(path.join(runtime, 'login.png'), update.qr, { width: 480, margin: 3 })
          .then(() => log('qr_ready', { path: path.join(runtime, 'login.png') })).catch(reject);
      }
      if (update.connection === 'open') resolve();
      if (update.connection === 'close' && !stopping) {
        const code = update.lastDisconnect?.error?.output?.statusCode;
        const error = Error(`Conexao encerrada: ${code ?? 'sem codigo'}`);
        error.code = code;
        reject(error);
      }
    });
  });
}
try {
  state = openAuthStore(path.join(root, 'auth/state.json'));
  log('socket_auth_start', { arch: process.arch });
  for (let attempt = 0; ; attempt++) {
    try { await connect(); break; }
    catch (error) {
      await writes;
      if (error.code !== DisconnectReason.restartRequired || attempt >= 2) throw error;
      log('pairing_restart');
    }
  }
  await writes;
  log('socket_connected', { rssMB: Math.round(process.memoryUsage().rss / 1048576) });
  const config = JSON.parse(fs.readFileSync(path.join(root, '../config.json'), 'utf8'));
  const groups = Object.values(await sock.groupFetchAllParticipating());
  for (const name of [config.testGroup, config.productionGroup]) {
    const matches = groups.filter(g => g.subject === name);
    if (matches.length !== 1) throw Error(`Grupo nao unico: ${name}; encontrados=${matches.length}`);
    log('group_verified', { name });
  }
  if (process.argv.includes('--test-once')) await testSend(sock, root, config, log);
  else if (process.argv.includes('--scheduled')) await testSend(sock, root, config, log, true);
  else log('auth_verified_no_send');
} catch (error) {
  log('auth_error', { error: error.message }); process.exitCode = 1;
} finally {
  stopping = true;
  clearTimeout(deadline);
  sock?.end(undefined);
  await writes.catch(() => {});
  fs.closeSync(fd);
  fs.unlinkSync(lock);
}
