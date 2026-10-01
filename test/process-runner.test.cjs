const test = require('node:test');
const assert = require('node:assert/strict');
const { runBounded } = require('../src/process-runner.cjs');
test('processo bem sucedido e erro propagado', async () => {
  await runBounded(process.execPath, ['-e', 'process.exit(0)']);
  await assert.rejects(runBounded(process.execPath, ['-e', 'process.exit(3)']), /codigo=3/);
});
test('processo travado tem prazo limitado', async () => {
  await assert.rejects(runBounded(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 300, killAfterMs: 100 }), /Tempo limite/);
});
test('cancelamento anterior nao executa processo', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runBounded('nao-existe', [], { signal: controller.signal }), /cancelada/);
});
