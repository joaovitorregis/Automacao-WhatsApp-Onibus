import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { generateMessageIDV2 } from '@whiskeysockets/baileys';
import lib from '../src/lib.cjs';
import { scheduledKey } from './policy.mjs';
import { resolveGroup } from './groups.mjs';

// Explicit, single test only. A persisted attempt prevents accidental reruns.
export async function testSend(sock, root, config, log, scheduled = false) {
  const testRecord = process.env.WHATSAPP_TEST_RECORD;
  if (!scheduled && testRecord && !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(testRecord)) throw Error('Identificador de teste invalido');
  const file = path.join(root, scheduled ? '../runtime/state.json' : testRecord ? `runtime/test-${testRecord}.json` : 'runtime/test-send.json');
  if (!scheduled && fs.existsSync(file)) throw Error('Teste ja registrado; verificar resultado antes de qualquer novo envio.');
  if (scheduled && !fs.existsSync(file)) throw Error('Estado de entregas ausente; envio recusado para evitar duplicacao');
  const state = scheduled && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, deliveries: {} };
  const name = scheduled ? config.productionGroup : config.testGroup;
  const groups = Object.values(await sock.groupFetchAllParticipating());
  const jid = resolveGroup(groups,name,scheduled?config.productionGroupId:config.testGroupId).id;
  const messageId = generateMessageIDV2(sock.user?.id);
  let key;
  if (scheduled) {
    const current = JSON.parse(fs.readFileSync(path.join(root, '../config.json'), 'utf8'));
    if (JSON.stringify(current) !== JSON.stringify(config)) throw Error('Configuracao mudou durante a conexao; envio cancelado');
    key = scheduledKey(current, state);
    if (!key) { log('scheduled_skip'); return; }
  }
  const text = lib.buildMessage(config);
  if (!scheduled && testRecord && process.env.WHATSAPP_TEST_REVISION) {
    const current = JSON.parse(fs.readFileSync(path.join(root, '../config.json'), 'utf8'));
    const hash = value => createHash('sha256').update(value).digest('hex');
    if (hash(JSON.stringify(current)) !== process.env.WHATSAPP_TEST_REVISION || JSON.stringify(current) !== JSON.stringify(config) || hash(text) !== process.env.WHATSAPP_TEST_TEXT_HASH) throw Error('Configuracao ou data mudou; confirme a previa novamente antes de enviar.');
  }
  const record = { messageId, group: name, text, status: 'attempting', timestamp: new Date().toISOString() };
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
