'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPanel } = require('../panel/server.cjs');
const model = require('../panel/model.cjs');
const base = { sendingEnabled: true, timezone: 'America/Fortaleza', productionGroup: 'Grupo Exemplo da Rota', testGroup: 'Grupo', studentLines: ['1. Participante Exemplo - Instituição Exemplo'], pausedDates: [], schedule: { weekdays: ['Mon','Tue','Thu','Fri'], hour: 2, minute: 0, graceMinutes: 20 } };
test('frontend retains all bound controls and unique element IDs', () => {
  const html = fs.readFileSync(path.join(__dirname,'../panel/public/index.html'),'utf8');
  const js = fs.readFileSync(path.join(__dirname,'../panel/public/app.js'),'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'IDs must remain unique');
  for (const match of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]), 'Missing bound element: '+match[1]);
  const css = fs.readFileSync(path.join(__dirname,'../panel/public/style.css'),'utf8');
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
  assert.ok(css.includes(':focus-visible'));
});
test('validation rejects privileged fields, impossible dates and invalid schedules', () => {
  assert.throws(() => model.validateChanges({ sendingEnabled: true }));
  assert.throws(() => model.validateChanges({ pausedDates: ['2026-02-30'] }));
  assert.throws(() => model.validateChanges({ schedule: { ...base.schedule, weekdays: [] } }));
  assert.throws(() => model.validateChanges({ studentLines: ['x\ny'] }));
  assert.deepEqual(model.validateChanges({ pausedDates: ['2026-10-05','2026-10-05'] }), { pausedDates: ['2026-10-05'] });
});
test('next run respects Fortaleza, pauses and disabled sending', () => {
  const now = new Date('2026-10-02T23:00:00Z');
  assert.equal(model.nextRun(base,now),'2026-10-05T05:00:00.000Z');
  assert.equal(model.nextRun({ ...base, pausedDates: ['2026-10-05'] },now),'2026-10-06T05:00:00.000Z');
  assert.equal(model.nextRun({ ...base, sendingEnabled: false },now),null);
});
test('API protects sessions, revision, configuration, tests and password', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'rota-panel-test-'));
  model.durableWrite(path.join(root,'config.json'),base);
  model.durableWrite(path.join(root,'runtime/state.json'),{ version: 1, deliveries: {} });
  let tests = 0;
  const server = await createPanel({ root, host: '127.0.0.1', port: 0,
    service: async () => ({ healthy: true, schedulerRunning: true, heartbeatAgeSeconds: 2 }),
    sendTest: async () => { tests++; return { status: 'server_accepted' }; }
  });
  t.after(async () => { await new Promise(r => server.close(r)); fs.rmSync(root,{recursive:true,force:true}); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const password = fs.readFileSync(path.join(root,'runtime/panel-access.txt'),'utf8').match(/Senha inicial: (.+)/)[1];
  let cookie = '', csrf = '';
  const request = async (route, method='GET',body, extra={}) => {
    const r = await fetch(origin+'/api/'+route,{ method,headers:{ Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,...extra },...(body === undefined ? {} : {body:JSON.stringify(body)}) });
    return { status:r.status, body:await r.json(), cookie:r.headers.get('set-cookie') };
  };
  assert.equal((await request('dashboard')).status,401);
  assert.equal((await request('login','POST',{password},{Origin:'http://evil.example'})).status,403);
  const login = await request('login','POST',{password}); assert.equal(login.status,200);
  cookie = login.cookie.split(';')[0]; csrf = login.body.csrf;
  assert.equal((await request('enabled','POST',{enabled:false},{'X-CSRF-Token':''})).status,403);
  const dash = (await request('dashboard')).body; assert.equal(dash.config.sendingEnabled,true);
  assert.equal((await request('config','PUT',{revision:'stale',changes:{pausedDates:[]}})).status,409);
  assert.equal((await request('config','PUT',{revision:dash.revision,changes:{sendingEnabled:false}})).status,400);
  assert.equal((await request('config','PUT',{revision:dash.revision,changes:{pausedDates:['2026-10-05']}})).status,200);
  let updated = (await request('dashboard')).body;
  assert.deepEqual(updated.config.pausedDates,['2026-10-05']);
  assert.equal((await request('enabled','POST',{enabled:false,revision:updated.revision})).status,200);
  updated = (await request('dashboard')).body; assert.equal(updated.config.sendingEnabled,false);
  assert.equal((await request('enabled','POST',{enabled:true,revision:updated.revision})).status,200);
  assert.equal((await request('test/send','POST',{challenge:'absent'})).status,409);
  const prepared = (await request('test/prepare','POST',{})).body;
  assert.equal(prepared.group,'Grupo');
  const send = await request('test/send','POST',{challenge:prepared.challenge}); assert.equal(send.status,202);
  assert.equal((await request('test/send','POST',{challenge:prepared.challenge})).status,409);
  assert.equal((await request('test/'+send.body.id)).body.status,'server_accepted'); assert.equal(tests,1);
  assert.equal((await request('password','POST',{oldPassword:password,newPassword:'short'})).status,400);
  assert.equal((await request('password','POST',{oldPassword:password,newPassword:'fixture-password-new-123'})).status,200);
  assert.equal((await request('dashboard')).status,401);
  assert.equal(fs.existsSync(path.join(root,'runtime/panel-access.txt')),false);
  assert.equal((await request('login','POST',{password})).status,401);
  assert.equal((await request('login','POST',{password:'fixture-password-new-123'})).status,200);
});
