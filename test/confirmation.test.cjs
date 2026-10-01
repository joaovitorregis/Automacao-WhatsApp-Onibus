'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { classifyAck, waitForServerAck, requiresManualReview, assertSendingEnabled } = require('../src/confirmation.cjs');
const id = 'true_group_message';
const message = ack => ({ id: { _serialized: id }, fromMe: true, ack });
test('somente ACK servidor, entregue, lido ou reproduzido confirma', () => {
  for (const ack of [1, 2, 3, 4]) assert.equal(classifyAck(message(ack), id), 'accepted');
  for (const value of [null, {}, message(undefined), message('1'), message(9), { ...message(1), fromMe: false }, { ...message(1), id: { _serialized: 'other' } }]) assert.equal(classifyAck(value, id), 'unknown');
  assert.equal(classifyAck(message(0), id), 'pending');
  assert.equal(classifyAck(message(-1), id), 'failed');
});
test('aguarda ACK antes de confirmar e guarda ID', async () => {
  let time = 0, count = 0;
  const result = await waitForServerAck({ getMessageById: async () => message(count++ ? 1 : 0) }, id,
    { timeoutMs: 3, intervalMs: 1, now: () => time, sleep: async ms => { time += ms; } });
  assert.deepEqual(result, { messageId: id, ack: 1, confirmation: 'server_ack' });
});

test('falha interna com ACK zero nao e classificada como apenas pendente', async () => {
  const failed = { ...message(0), isSendFailure: true };
  assert.equal(classifyAck(failed, id), 'failed');
  assert.equal(classifyAck({ ...failed, fromMe: false }, id), 'unknown');
  assert.equal(classifyAck({ ...failed, isSendFailure: false }, id), 'pending');
  await assert.rejects(waitForServerAck({ getMessageById: async () => failed }, id), /isSendFailure=true/);
});
test('pendente nao vira sucesso ao expirar', async () => {
  let time = 0;
  await assert.rejects(waitForServerAck({ getMessageById: async () => message(0) }, id,
    { timeoutMs: 2, intervalMs: 1, now: () => time, sleep: async ms => { time += ms; } }), /sem confirmacao/);
});
test('falha explicita, API quebrada e falta de ID impedem sucesso', async () => {
  await assert.rejects(waitForServerAck({ getMessageById: async () => message(-1) }, id), /ACK_ERROR/);
  await assert.rejects(waitForServerAck({ getMessageById: async () => { throw Error('API falhou'); } }, id), /API falhou/);
  await assert.rejects(waitForServerAck({}, ''), /sem ID/);
});
test('consulta travada tem limite de tempo', async () => {
  await assert.rejects(waitForServerAck({ getMessageById: () => new Promise(() => {}) }, id, { timeoutMs: 15 }), /limite/);
});
test('tentativa interrompida e incerta nao podem ser repetidas automaticamente', () => {
  assert.equal(requiresManualReview({ status: 'attempting' }), true);
  assert.equal(requiresManualReview({ status: 'uncertain' }), true);
  assert.equal(requiresManualReview({ status: 'not_sent' }), false);
});
test('envios bloqueados por padrao, inclusive testes forcados', () => {
  for (const mode of ['test', 'test-force', 'scheduled']) {
    assert.throws(() => assertSendingEnabled({}, mode), /desativados/);
    assert.throws(() => assertSendingEnabled({ sendingEnabled: 'true' }, mode), /desativados/);
    assert.doesNotThrow(() => assertSendingEnabled({ sendingEnabled: true }, mode));
  }
  for (const mode of ['verify', 'dry-run', 'auth', 'ack-check']) assert.doesNotThrow(() => assertSendingEnabled({}, mode));
});
test('CLI entregue recusa envio forcado antes de iniciar cliente', () => {
  const fixture = fs.mkdtempSync(path.join(__dirname, '../.cli-test-'));
  try {
    fs.cpSync(path.join(__dirname, '../src'), path.join(fixture, 'src'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'config.json'), JSON.stringify({ ...require('../config.example.json'), sendingEnabled: false }));
    const result = spawnSync(process.execPath, [path.join(fixture, 'src/automation.cjs'), '--test-force'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Envios desativados/);
    assert.doesNotMatch(result.stdout, /client_starting|send_started/);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});
