import test from 'node:test';
import assert from 'node:assert/strict';
import {panelModeFrom} from './mode.mjs';
test('panel connection modes cannot combine with sender arguments',()=>{
  for(const mode of ['--panel-check','--panel-pair']) {
    assert.equal(panelModeFrom([mode]),true);
    for(const other of ['--test-once','--scheduled','--verify','--panel-pair','--panel-check']) assert.throws(()=>panelModeFrom([mode,other]),/nao permite/);
  }
  assert.equal(panelModeFrom(['--scheduled']),false);
});
