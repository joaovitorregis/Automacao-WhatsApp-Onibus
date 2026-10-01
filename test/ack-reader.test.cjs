'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createAckReader } = require('../src/ack-reader.cjs');
const { waitForServerAck } = require('../src/confirmation.cjs');
test('cliente nativo abre perfil isolado sem injetar eventos da biblioteca', async () => {
  const { NativeClient } = require('../src/native-client.cjs');
  const calls = [];
  const page = { setUserAgent: async ua => calls.push(ua), goto: async url => calls.push(url),
    evaluate: async () => ({ ready: true, qr: null }) };
  const browser = { pages: async () => [page], close: async () => calls.push('closed') };
  const client = new NativeClient({ sessionDir: '/repair', userAgent: 'Chrome/138', puppeteer: { headless: true } },
    { launch: async opts => { assert.match(opts.userDataDir, /repair[\\/]session$/); return browser; } });
  let ready = 0;
  client.on('ready', () => ready++);
  await client.initialize();
  await client.destroy();
  assert.equal(ready, 1);
  assert.deepEqual(calls, ['Chrome/138', 'https://web.whatsapp.com', 'closed']);
});
test('cliente usa a versao real do Chromium e recusa versao desconhecida', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/automation.cjs'), 'utf8');
  const start = source.indexOf('function createClient(mode) {');
  const end = source.indexOf('\nfunction waitUntilReady', start);
  assert.ok(start > 0 && end > start);
  function build(version) {
    const create = vm.runInNewContext(`(${source.slice(start, end).trim()})`, {
      fs: { existsSync: () => true, mkdirSync: () => {} },
      execFileSync: () => version,
      chromePath: '/chromium', sessionDir: '/isolated-session', process: { env: {} },
      Client: function(options) { this.options = options; },
      LocalAuth: function(options) { this.options = options; }
    });
    return create('auth').options;
  }
  const options = build('Chromium 138.0.7204.100\n');
  assert.match(options.userAgent, /Chrome\/138\.0\.7204\.100/);
  assert.doesNotMatch(options.userAgent, /HeadlessChrome|Chrome\/101\./);
  assert.equal(options.authStrategy.options.dataPath, '/isolated-session');
  assert.throws(() => build('unknown'), /versao real/);
});
test('detector da interface identifica falha nova e ignora falha antiga ou recebida', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/automation.cjs'), 'utf8');
  const start = source.indexOf('(expected, previousIds) => {');
  const end = source.indexOf(',\n    { timeout: 20_000 }', start);
  const callback = source.slice(start, end).trim();
  assert.ok(start > 0 && end > start);
  function run(previous, own = true) {
    const node = {
      closest: () => ({ getAttribute: () => 'failed-id' }),
      querySelector: selector => selector.includes('tail-out') ? own : true,
      querySelectorAll: () => []
    };
    const main = { querySelectorAll: () => [node] };
    return vm.runInNewContext(`(${callback})`, { document: { querySelector: () => main } })('expected', previous);
  }
  assert.equal(run([]).failed, true);
  assert.equal(run([]).messageId, 'failed-id');
  assert.equal(run(['failed-id']), false);
  assert.equal(run([], false), false);
});
function reader(models) {
  return createAckReader({ pupPage: { evaluate: async (fn, id) => vm.runInNewContext(`(${fn.toString()})`, {
    window: { require: () => ({ Msg: { getModelsArray: () => models } }) }
  })(id) } });
}
const outgoing = { id: { id: 'stanza', _serialized: 'true_group_stanza', fromMe: true }, ack: 1 };
test('leitor preserva falha interna com ACK zero', async () => {
  const result = await reader([{ ...outgoing, ack: 0, isSendFailure: true }]).getMessageById('stanza');
  assert.equal(result.isSendFailure, true);
  assert.equal(result.ack, 0);
});
test('resolve ID curto da UI e confirma com ID canonico', async () => {
  const result = await waitForServerAck(reader([outgoing]), 'stanza');
  assert.equal(result.messageId, 'true_group_stanza');
  assert.equal(result.confirmation, 'server_ack');
});
test('aceita ID serializado exato', async () => {
  assert.equal((await reader([outgoing]).getMessageById('true_group_stanza')).ack, 1);
});
test('recusa ID ausente, ambiguo e mensagem recebida', async () => {
  for (const models of [[], [outgoing, outgoing], [{ ...outgoing, id: { ...outgoing.id, fromMe: false } }]]) {
    assert.equal(await reader(models).getMessageById('stanza'), null);
  }
  assert.equal(await reader([outgoing]).getMessageById('different'), null);
});
test('suporta chave nativa moderna sem campo serializado', async () => {
  const result = await waitForServerAck(reader([{ id: { id: 'stanza', fromMe: true }, ack: 1 }]), 'stanza');
  assert.equal(result.messageId, 'stanza');
});
