import fs from 'node:fs';
import path from 'node:path';
import { generateMessageIDV2 } from '@whiskeysockets/baileys';
import lib from '../src/lib.cjs';
import { scheduledKey } from './policy.mjs';

// Explicit, single test only. A persisted attempt prevents accidental reruns.
export async function testSend(sock, root, config, log, scheduled = false) {
  const file = path.join(root, scheduled ? '../runtime/state.json' : 'runtime/test-send.json');
  if (!scheduled && fs.existsSync(file)) throw Error('Teste ja registrado; verificar resultado antes de qualquer novo envio.');
  if (scheduled && !fs.existsSync(file)) throw Error('Estado de entregas ausente; envio recusado para evitar duplicacao');
  const state = scheduled && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, deliveries: {} };
  const name = scheduled ? config.productionGroup : config.testGroup;
  const groups = Object.values(await sock.groupFetchAllParticipating());
  const matches = groups.filter(group => group.subject === name);
  if (matches.length !== 1) throw Error('Grupo de teste ausente ou ambiguo');
  const jid = matches[0].id;
  const messageId = generateMessageIDV2(sock.user?.id);
  let key;
  if (scheduled) {
    const current = JSON.parse(fs.readFileSync(path.join(root, '../config.json'), 'utf8'));
    if (JSON.stringify(current) !== JSON.stringify(config)) throw Error('Configuracao mudou durante a conexao; envio cancelado');
    key = scheduledKey(current, state);
    if (!key) { log('scheduled_skip'); return; }
  }
  const record = { messageId, group: name, text: lib.buildMessage(config), status: 'attempting', timestamp: new Date().toISOString() };
  if (scheduled) state.deliveries[key] = record;
  const persist = () => {
    const tmp = file + '.tmp';
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(scheduled ? state : record)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
    if (process.platform !== 'win32') {
      const dir = fs.openSync(path.dirname(file), 'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    }
  };
  persist();
  let resolveAck, rejectAck;
  const ack = new Promise((resolve, reject) => { resolveAck = resolve; rejectAck = reject; });
  ack.catch(() => {});
  const listener = node => {
    if (node.attrs?.id !== messageId || node.attrs?.class !== 'message') return;
    if (node.attrs.error) rejectAck(Error(`Servidor rejeitou: ${node.attrs.error}`));
    else resolveAck();
  };
  sock.ws.on('CB:ack,class:message', listener);
  const timer = setTimeout(() => rejectAck(Error('ACK nao confirmado em 90 segundos')), 90000);
  try {
    log(scheduled ? 'scheduled_send_started' : 'test_send_started', { messageId, group: name });
    await Promise.race([
      (async () => { await sock.sendMessage(jid, { text: record.text }, { messageId }); await ack; })(),
      ack.then(() => undefined)
    ]);
    record.status = scheduled ? 'sent' : 'server_accepted';
    record.confirmedAt = new Date().toISOString();
    persist();
    log(scheduled ? 'scheduled_server_ack_confirmed' : 'test_server_ack_confirmed', { messageId });
  } catch (error) {
    record.status = 'uncertain'; record.error = error.message; persist();
    throw error;
  } finally {
    clearTimeout(timer);
    sock.ws.off('CB:ack,class:message', listener);
  }
}
