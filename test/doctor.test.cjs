'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { diagnose } = require('../scripts/doctor.cjs');
const base = require('../config.example.json');
const now = Date.parse('2026-10-03T12:00:00Z');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rota-doctor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(path.join(root,file)), { recursive: true });
    fs.writeFileSync(path.join(root,file), JSON.stringify(data));
  };
  write('config.json', {...base, productionGroup:'PRIVATE-GROUP', studentLines:['PRIVATE-PARTICIPANT']});
  write('runtime/state.json', {version:1, deliveries:{}});
  write('runtime/heartbeat.json', {pid:42, timestamp:new Date(now).toISOString()});
  write('socket/node_modules/@whiskeysockets/baileys/package.json', {version:'fixture'});
  return {root, write, run:()=>diagnose(root,{now,nodeVersion:'24.17.0'})};
}
test('doctor reads valid fixture without writes or private data disclosure', t => {
  const f=fixture(t);
  const snapshot=()=>fs.readdirSync(f.root,{recursive:true}).filter(file=>fs.statSync(path.join(f.root,file)).isFile()).map(file=>[file,fs.readFileSync(path.join(f.root,file),'utf8')]);
  const before=snapshot(), report=f.run();
  assert.equal(report.ok,true);assert.deepEqual(snapshot(),before);
  assert.equal(JSON.stringify(report).includes('PRIVATE-'),false);
  assert.equal(report.checks.find(c=>c.id==='sending').status,'warning');
});
test('doctor reports corrupt or missing state without creating replacements', t => {
  const f=fixture(t);
  f.write('runtime/state.json',{version:1,deliveries:[]});
  assert.equal(f.run().ok,false);
  fs.unlinkSync(path.join(f.root,'runtime/state.json'));
  assert.equal(f.run().checks.find(c=>c.id==='runtime/state.json').status,'error');
  assert.equal(fs.existsSync(path.join(f.root,'runtime/state.json')),false);
});
test('doctor rejects stale, future and malformed heartbeats', t => {
  const f=fixture(t);
  for(const timestamp of [new Date(now-240000).toISOString(),new Date(now+1).toISOString(),'invalid']) {
    f.write('runtime/heartbeat.json',{pid:42,timestamp});assert.equal(f.run().ok,false);
  }
});
test('doctor rejects dangerous config shapes without exposing supplied values', t => {
  const f=fixture(t);
  for(const changes of [{sendingEnabled:'true'},{timezone:'PRIVATE-INVALID'},{pausedDates:['2026-02-30']},{studentLines:[42]},{schedule:{...base.schedule,weekdays:['INVALID']}}]) {
    f.write('config.json',{...base,...changes});
    const report=f.run();assert.equal(report.ok,false);assert.equal(JSON.stringify(report).includes('PRIVATE-INVALID'),false);
  }
});
test('doctor CLI missing installation fails cleanly and rejects unknown options', t => {
  const f=fixture(t), script=path.resolve(__dirname,'../scripts/doctor.cjs');
  fs.unlinkSync(path.join(f.root,'runtime/state.json'));
  const result=spawnSync(process.execPath,[script,'--root',f.root,'--json'],{encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).ok,false);
  assert.equal(spawnSync(process.execPath,[script,'--repair'],{encoding:'utf8'}).status,2);
});

test('doctor only identifies Node 24 as validated and warns on other majors', t => {
  const f=fixture(t);
  for(const [major,status] of [[23,'warning'],[24,'ok'],[25,'warning']]) {
    const report=diagnose(f.root,{now,nodeVersion:major+'.0.0'});
    assert.equal(report.checks.find(c=>c.id==='node').status,status);
  }
});
test('doctor rejects unknown statuses and warns about unresolved attempts privately', t => {
  const f=fixture(t);
  for(const status of ['','garbage']) {
    f.write('runtime/state.json',{version:1,deliveries:{'PRIVATE-KEY':{status}}});
    assert.equal(f.run().ok,false);
  }
  for(const status of ['attempting','uncertain','failed']) {
    f.write('runtime/state.json',{version:1,deliveries:{'PRIVATE-KEY':{status,text:'PRIVATE-TEXT'}}});
    const report=f.run();
    assert.equal(report.checks.find(c=>c.id==='attempts').status,'warning');
    assert.equal(JSON.stringify(report).includes('PRIVATE-'),false);
  }
});
test('doctor CLI success is JSON, private and read-only', t => {
  const f=fixture(t),script=path.resolve(__dirname,'../scripts/doctor.cjs');
  f.write('runtime/heartbeat.json',{pid:42,timestamp:new Date().toISOString()});
  const before=fs.readFileSync(path.join(f.root,'config.json'),'utf8');
  const result=spawnSync(process.execPath,[script,'--root',f.root,'--json'],{encoding:'utf8'});
  assert.equal(result.status,0);
  const report=JSON.parse(result.stdout);
  assert.equal(report.ok,true);assert.ok(report.limitations.length);
  assert.equal(result.stdout.includes('PRIVATE-'),false);
  assert.equal(fs.readFileSync(path.join(f.root,'config.json'),'utf8'),before);
});
