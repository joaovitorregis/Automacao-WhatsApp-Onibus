import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveGroup} from './groups.mjs';
const groups=[{id:'123@g.us',subject:'Grupo'},{id:'456@g.us',subject:'Grupo'}];
test('group selection distinguishes identical names by exact ID',()=>{
  assert.equal(resolveGroup(groups,'Grupo','456@g.us').id,'456@g.us');
  assert.throws(()=>resolveGroup(groups,'Grupo'),/ambiguo/);
  assert.throws(()=>resolveGroup(groups,'Renomeado','456@g.us'),/renomeado/);
  assert.throws(()=>resolveGroup(groups,'Grupo','789@g.us'),/ausente/);
  assert.equal(resolveGroup([groups[0]],'Grupo').id,'123@g.us');
});
