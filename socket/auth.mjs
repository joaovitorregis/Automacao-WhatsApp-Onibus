import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import makeWASocket, { makeCacheableSignalKeyStore, DisconnectReason, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { openAuthStore } from './auth-store.mjs';
import { testSend } from './test-send.mjs';
import { acquireLock } from './lock.mjs';
import { resolveGroup } from './groups.mjs';
import lib from '../src/lib.cjs';
import {panelModeFrom} from './mode.mjs';

const panelMode=panelModeFrom(process.argv.slice(2));
const panelId=process.env.WHATSAPP_PANEL_JOB;
if(panelMode && !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(panelId || '')) throw Error('Identificador do painel invalido');

process.umask(0o077);
const root = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(root, 'runtime');
fs.mkdirSync(runtime, { recursive: true });
const lock = path.join(root, '../runtime/automation.lock');
const fd = acquireLock(lock, process.env.WHATSAPP_KERNEL_LOCK === '1');
const panelFile=panelMode?path.join(runtime,`panel-${panelId}.json`):null;
const panelUpdate=(status,details={})=>{if(panelFile) lib.writeJsonAtomic(panelFile,{status,timestamp:new Date().toISOString(),...details});};
const logger = pino({ level: 'silent' });
const log = (event, details = {}) => {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), event, ...details });
  fs.appendFileSync(path.join(runtime, 'events.jsonl'), line + '\n');
  console.log(line);
};
let sock;
let stopping = false;
let qrVersion = 0;
let state;
let writes = Promise.resolve();
function terminate(signal) {
  stopping = true;
  panelUpdate('expired');
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
        if (process.argv.includes('--scheduled') || process.argv.includes('--panel-check')) { reject(Error('Sessao desconectada: vinculacao manual necessaria')); return; }
        if(panelMode) { const version=++qrVersion; QRCode.toDataURL(update.qr,{width:480,margin:3}).then(qr=>{if(version===qrVersion && !stopping) panelUpdate('qr',{qr});}).catch(reject); return; }
        QRCode.toFile(path.join(runtime, 'login.png'), update.qr, { width: 480, margin: 3 })
          .then(() => log('qr_ready', { path: path.join(runtime, 'login.png') })).catch(reject);
      }
      if (update.connection === 'open') { qrVersion++; resolve(); }
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
  if(panelMode) {
    const current=JSON.parse(fs.readFileSync(path.join(root,'../config.json'),'utf8'));
    if(current.sendingEnabled!==false) throw Error('Desative envios antes de verificar ou vincular');
    panelUpdate('checking');
  }
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
  if(panelMode) {
    panelUpdate('verified',{groups:groups.map(g=>({id:g.id,name:g.subject})).filter(g=>/^\d+(?:-\d+)?@g\.us$/.test(g.id) && typeof g.name==='string' && g.name.trim() && g.name.length<=120 && !/[\r\n\x00]/.test(g.name)).slice(0,1000)});
  } else for (const [name,id] of [[config.testGroup,config.testGroupId],[config.productionGroup,config.productionGroupId]]) {
    resolveGroup(groups,name,id);
    log('group_verified', { name });
  }
  if (!panelMode && process.argv.includes('--test-once')) await testSend(sock, root, config, log);
  else if (!panelMode && process.argv.includes('--scheduled')) await testSend(sock, root, config, log, true);
  else log('auth_verified_no_send');
} catch (error) {
  panelUpdate('disconnected');
  log('auth_error', { error: error.message }); process.exitCode = 1;
} finally {
  stopping = true;
  qrVersion++;
  clearTimeout(deadline);
  sock?.end(undefined);
  await writes.catch(() => {});
  fs.closeSync(fd);
  fs.unlinkSync(lock);
}
