import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAuthStore } from './auth-store.mjs';
test('credenciais e chaves binárias sobrevivem à reabertura; exclusão persiste', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-auth-test-'));
  const file = path.join(dir, 'auth.json');
  try {
    const first = openAuthStore(file);
    await first.saveCreds();
    await first.state.keys.set({ session: { one: Buffer.from([1, 2, 3]) } });
    const second = openAuthStore(file);
    assert.deepEqual((await second.state.keys.get('session', ['one'])).one, Buffer.from([1, 2, 3]));
    assert.deepEqual(second.state.creds.noiseKey.public, first.state.creds.noiseKey.public);
    await second.state.keys.set({ session: { one: null } });
    assert.equal((await openAuthStore(file).state.keys.get('session', ['one'])).one, undefined);
    fs.writeFileSync(file, '{broken');
    assert.throws(() => openAuthStore(file));
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  } finally { fs.rmSync(dir, { recursive: true }); }
});
