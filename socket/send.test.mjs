import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testSend } from './test-send.mjs';

for (const error of [undefined, '500']) test(`persist exact ACK outcome: ${error ?? 'success'}`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-send-test-'));
  fs.mkdirSync(path.join(root, 'runtime'));
  let calls = 0;
  const ws = new EventEmitter();
  const sock = { ws, user: { id: '123456789:1@s.whatsapp.net' },
    groupFetchAllParticipating: async () => ({ g: { id: 'test@g.us', subject: 'Grupo' } }),
    sendMessage: async (jid, content, options) => {
      calls++;
      assert.equal(jid, 'test@g.us');
      const stored = JSON.parse(fs.readFileSync(path.join(root, 'runtime/test-send.json')));
      assert.equal(stored.status, 'attempting');
      assert.equal(stored.messageId, options.messageId);
      ws.emit('CB:ack,class:message', { attrs: { id: 'wrong-id', class: 'message', error: '500' } });
      ws.emit('CB:ack,class:message', { attrs: { id: options.messageId, class: 'message', error } });
    }
  };
  const config = { testGroup: 'Grupo', timezone: 'America/Fortaleza', studentLines: ['1. Participante Exemplo - Instituição Exemplo'] };
  try {
    if (error) await assert.rejects(testSend(sock, root, config, () => {}), /Servidor rejeitou/);
    else await testSend(sock, root, config, () => {});
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'runtime/test-send.json'))).status, error ? 'uncertain' : 'server_accepted');
    await assert.rejects(testSend(sock, root, config, () => {}), /Teste ja registrado/);
    assert.equal(calls, 1);
    assert.equal(ws.listenerCount('CB:ack,class:message'), 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('estado de producao ausente bloqueia antes da conexao e do envio', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-state-test-'));
  const root = path.join(base, 'socket');
  fs.mkdirSync(root);
  try {
    await assert.rejects(testSend({}, root, {}, () => {}, true), /Estado de entregas ausente/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('falha ao persistir impede transmitir mensagem', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-disk-test-'));
  fs.mkdirSync(path.join(root, 'runtime/test-send.json.tmp'), { recursive: true });
  let sent = false;
  const sock = { user: { id: '123456789:1@s.whatsapp.net' },
    groupFetchAllParticipating: async () => ({ g: { id: 'test@g.us', subject: 'Grupo' } }),
    sendMessage: async () => { sent = true; }
  };
  try {
    await assert.rejects(testSend(sock, root, { testGroup: 'Grupo', timezone: 'America/Fortaleza', studentLines: ['teste'] }, () => {}));
    assert.equal(sent, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('panel test uses unique durable record without clearing historical test', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-panel-send-'));
  fs.mkdirSync(path.join(root,'runtime'));
  fs.writeFileSync(path.join(root,'runtime/test-send.json'),'historical-record');
  const id = randomUUID(); process.env.WHATSAPP_TEST_RECORD = id;
  const ws = new EventEmitter(); let calls = 0;
  const sock = { ws, user:{id:'123456789:1@s.whatsapp.net'}, groupFetchAllParticipating:async()=>({g:{id:'test@g.us',subject:'Grupo'}}), sendMessage:async(_jid,_text,options)=>{calls++;ws.emit('CB:ack,class:message',{attrs:{id:options.messageId,class:'message'}});} };
  try {
    await testSend(sock,root,{testGroup:'Grupo',timezone:'America/Fortaleza',studentLines:['teste']},()=>{});
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,`runtime/test-${id}.json`))).status,'server_accepted');
    assert.equal(fs.readFileSync(path.join(root,'runtime/test-send.json'),'utf8'),'historical-record');
    await assert.rejects(testSend(sock,root,{},()=>{}),/Teste ja registrado/); assert.equal(calls,1);
    process.env.WHATSAPP_TEST_RECORD = '../../escape'; await assert.rejects(testSend(sock,root,{},()=>{}),/Identificador/);
  } finally { delete process.env.WHATSAPP_TEST_RECORD; fs.rmSync(root,{recursive:true,force:true}); }
});
