'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
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

test('panel installation includes every staged connector regression test',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../panel/install.cjs'),'utf8');
  const manifest=source.match(/const files = \[([^\n]+)\];/)[1];
  for(const file of ['socket/send.test.mjs','socket/groups.test.mjs','socket/mode.test.mjs','test/panel.test.cjs','test/whatsapp-panel.test.cjs','test/panel-network.test.cjs']){
    assert.ok(manifest.includes("'"+file+"'"),'Missing installed test: '+file);
    assert.equal(fs.statSync(path.join(__dirname,'..',file)).isFile(),true);
  }
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

async function fixture(t, config = base) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'rota-panel-regression-'));
  model.durableWrite(path.join(root,'config.json'),config);
  model.durableWrite(path.join(root,'runtime/state.json'),{version:1,deliveries:{}});
  const server = await createPanel({root,host:'127.0.0.1',port:0,service:async()=>({healthy:true})});
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});});
  const origin = `http://127.0.0.1:${server.address().port}`;
  const password = fs.readFileSync(path.join(root,'runtime/panel-access.txt'),'utf8').match(/Senha inicial: (.+)/)[1];
  const request = async(route,method='GET',body,session={})=>{
    const r=await fetch(origin+'/api/'+route,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:session.cookie||'','X-CSRF-Token':session.csrf||''},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  };
  const login=async(pass=password)=>{const r=await request('login','POST',{password:pass});return {...r,csrf:r.body.csrf};};
  return {root,origin,password,request,login};
}
test('parallel login failures reserve the shared budget before hashing',async t=>{
  const f=await fixture(t);
  const responses=await Promise.all(Array.from({length:16},()=>f.login('wrong-fixture-password')));
  assert.equal(responses.filter(r=>r.status===401).length,8);
  assert.equal(responses.filter(r=>r.status===429).length,8);
  assert.equal((await f.login('another-invalid-password')).status,429);
});
test('successful login preserves reservations for concurrent failed logins',async t=>{
  const f=await fixture(t);
  const mixed=await Promise.all([f.login(),...Array.from({length:7},()=>f.login('wrong-fixture-password'))]);
  assert.equal(mixed[0].status,200);assert.equal(mixed.filter(r=>r.status===401).length,7);
  const subsequent=await Promise.all(Array.from({length:9},()=>f.login('wrong-fixture-password')));
  assert.equal(subsequent.filter(r=>r.status===401).length,1);
  assert.equal(subsequent.filter(r=>r.status===429).length,8);
});
test('only one concurrent password change succeeds and old login stays revoked',async t=>{
  const f=await fixture(t),session=await f.login();
  const responses=await Promise.all(['fixture-new-password-A','fixture-new-password-B'].map(newPassword=>f.request('password','POST',{oldPassword:f.password,newPassword},session)));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,401]);
  assert.equal((await f.request('dashboard','GET',undefined,session)).status,401);
  assert.equal((await f.login()).status,401);
  const passwords=['fixture-new-password-A','fixture-new-password-B'];
  const changed=passwords[responses.findIndex(r=>r.status===200)];
  assert.equal((await f.login(changed)).status,200);
});
test('login queued during password rotation cannot revive an old-password session',async t=>{
  const f=await fixture(t),session=await f.login();
  const change=f.request('password','POST',{oldPassword:f.password,newPassword:'fixture-rotated-password'},session);
  await new Promise(r=>setTimeout(r,15));
  const stale=f.login();
  assert.equal((await change).status,200);
  assert.equal((await stale).status,401);
  assert.equal((await f.login('fixture-rotated-password')).status,200);
});
test('UTF-8 split across TCP chunks is decoded only after reassembly',async t=>{
  const f=await fixture(t),session=await f.login(),dash=await f.request('dashboard','GET',undefined,session);
  const body=Buffer.from(JSON.stringify({revision:dash.body.revision,changes:{productionGroup:'Instituição teste'}}));
  const split=body.indexOf(Buffer.from('ç'))+1;
  const response=await new Promise((resolve,reject)=>{
    const req=http.request(f.origin+'/api/config',{method:'PUT',headers:{Origin:f.origin,Cookie:session.cookie,'X-CSRF-Token':session.csrf,'Content-Type':'application/json'}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});
    req.on('error',reject);req.write(body.subarray(0,split));setTimeout(()=>req.end(body.subarray(split)),15);
  });
  assert.equal(response,200);
  assert.equal((await f.request('dashboard','GET',undefined,session)).body.config.productionGroup,'Instituição teste');
  assert.equal((await f.request('config','PUT',null,session)).status,400);
});
test('test history is ordered chronologically before its record limit',async t=>{
  const f=await fixture(t),session=await f.login(),latest='test-00000000-0000-4000-8000-000000000001.json';
  model.durableWrite(path.join(f.root,'socket/runtime',latest),{group:'fixture',status:'server_accepted',timestamp:'2030-01-01T00:00:00Z'});
  for(let i=1;i<=50;i++)model.durableWrite(path.join(f.root,'socket/runtime',`test-ffffffff-ffff-4fff-8fff-${String(i).padStart(12,'0')}.json`),{group:'fixture',status:'server_accepted',timestamp:'2020-01-01T00:00:00Z'});
  const history=(await f.request('dashboard','GET',undefined,session)).body.history;
  assert.equal(history.length,50);assert.equal(history[0].key,latest);
});
test('legacy config without optional pausedDates still has a working dashboard',async t=>{
  const config={...base};delete config.pausedDates;
  const f=await fixture(t,config),session=await f.login();
  const r=await f.request('dashboard','GET',undefined,session);
  assert.equal(r.status,200);assert.deepEqual(r.body.config.pausedDates,[]);
  assert.equal(r.body.revision,model.revision(config));
});

test('logout while a password change is hashing cancels that pending write',async t=>{
  const f=await fixture(t),session=await f.login();
  const change=f.request('password','POST',{oldPassword:f.password,newPassword:'fixture-cancelled-password'},session);
  await new Promise(r=>setTimeout(r,10));
  assert.equal((await f.request('logout','POST',{},session)).status,200);
  assert.equal((await change).status,401);
  assert.equal((await f.login()).status,200);
  assert.equal((await f.login('fixture-cancelled-password')).status,401);
});

async function uiFixture() {
  const elements=new Map();
  const node=()=>({textContent:'',value:'',hidden:false,disabled:false,checked:false,children:[],classList:{toggle(){}},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},setAttribute(){},removeAttribute(){},querySelector(){return node();},showModal(){},close(){}});
  const el=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
  const weekdays=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(value=>({...node(),value}));
  const state={config:JSON.parse(JSON.stringify(base)),offline:false};
  const data=()=>({config:JSON.parse(JSON.stringify(state.config)),revision:model.revision(state.config),health:{healthy:true,heartbeatAgeSeconds:1},history:[],preview:'fixture',nextRun:null,now:new Date().toISOString()});
  const context={document:{getElementById:el,createElement:node,createTextNode:text=>({textContent:text}),querySelectorAll:selector=>selector==='.day-picker input'?weekdays:selector==='.day-picker input:checked'?weekdays.filter(x=>x.checked):selector.startsWith('#app-view button')?['toggle-enabled','wa-check','wa-pair','wa-disable','wa-production','wa-test','wa-save-production','wa-save-test','test-open'].map(el):[]},window:{addEventListener(){},confirm:()=>true},Intl,Date,TypeError,FormData:class{},setTimeout:()=>0,clearTimeout(){},console,
    fetch:async(url,options)=>{
      if(state.networkFailure) throw new TypeError('Failed to fetch');
      if(state.offline)throw Error('fixture offline');
      let result={csrf:'fixture-csrf'},status=200;
      if(url==='/api/dashboard'){if(state.beforeDashboard)await state.beforeDashboard();result=data();}
      if(url==='/api/config'){
        const body=JSON.parse(options.body);
        if(state.beforeConfig) await state.beforeConfig();
        if(body.revision!==model.revision(state.config)){status=409;result={error:'fixture conflict'};}
        else{state.config={...state.config,...body.changes};result={ok:true};}
      }
      return{ok:status===200,status,json:async()=>result};
    }};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../panel/public/app.js'),'utf8'),context);
  await new Promise(r=>setImmediate(r));
  return{state,el,context,refresh:()=>vm.runInContext('refresh()',context),submit:async()=>{el('settings-form').onsubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));}};
}
test('UI preserves dirty edits across pauses and saves against the updated revision',async()=>{
  const f=await uiFixture();f.el('student-lines').value='1. Edited fixture';f.el('settings-form').oninput();
  f.state.config.pausedDates=['2026-10-05'];await f.refresh();
  assert.equal(f.el('student-lines').value,'1. Edited fixture');assert.equal(f.el('form-conflict').hidden,true);
  await f.submit();assert.deepEqual(f.state.config.studentLines,['1. Edited fixture']);assert.deepEqual(f.state.config.pausedDates,['2026-10-05']);
});

test('schedule edits never overwrite group destinations or their IDs',async()=>{
  const f=await uiFixture();
  f.state.config.productionGroupId='fixture-main@g.us';f.state.config.testGroupId='fixture-test@g.us';
  await f.refresh();f.el('student-lines').value='1. Updated fixture';f.el('settings-form').oninput();await f.submit();
  assert.equal(f.state.config.productionGroup,base.productionGroup);
  assert.equal(f.state.config.testGroup,base.testGroup);
  assert.equal(f.state.config.productionGroupId,'fixture-main@g.us');
  assert.equal(f.state.config.testGroupId,'fixture-test@g.us');
  const html=fs.readFileSync(path.join(__dirname,'../panel/public/index.html'),'utf8');
  assert.ok(!html.includes('id="production-group"'));assert.ok(!html.includes('id="test-group"'));
});

test('edits made while saving remain unsaved and can be saved next',async()=>{
  const f=await uiFixture();
  f.el('student-lines').value='1. First edit';f.el('settings-form').oninput();
  f.state.beforeConfig=async()=>{
    f.el('student-lines').value='1. Later edit';f.el('settings-form').oninput();
    f.state.beforeConfig=null;
  };
  await f.submit();
  assert.deepEqual(f.state.config.studentLines,['1. First edit']);
  assert.equal(f.el('student-lines').value,'1. Later edit');
  assert.ok(f.el('toast').textContent.includes('ainda precisa ser salva'));
  await f.submit();
  assert.deepEqual(f.state.config.studentLines,['1. Later edit']);
});

test('empty group selectors explain verification and block selection',async()=>{
  const f=await uiFixture();
  assert.equal(f.el('wa-production').disabled,true);
  assert.equal(f.el('wa-save-test').disabled,true);
  assert.equal(f.el('wa-test').children[0].textContent,'Verifique a conta para carregar grupos');
  assert.equal(f.el('wa-disable').hidden,false);
});

test('account verification blocks activation and testing until completion',async()=>{
  const f=await uiFixture();
  vm.runInContext("renderWhatsApp({status:'checking',active:true,groups:[]})",f.context);
  assert.equal(f.el('toggle-enabled').disabled,true);assert.equal(f.el('test-open').disabled,true);
  vm.runInContext("renderWhatsApp({status:'verified',active:false,groups:[]})",f.context);
  assert.equal(f.el('toggle-enabled').disabled,false);assert.equal(f.el('test-open').disabled,false);
});

test('group confirmation identifies exact name and ID before mutation',async()=>{
  const f=await uiFixture();let confirmation;
  f.context.window.confirm=text=>{confirmation=text;return false;};
  vm.runInContext("renderWhatsApp({status:'verified',active:false,groups:[{id:'12345@g.us',name:'Fixture selected'}]})",f.context);
  f.el('wa-production').value='12345@g.us';
  await f.el('wa-save-production').onclick();
  assert.match(confirmation,/Fixture selected/);assert.match(confirmation,/12345@g.us/);
  assert.equal(f.state.config.productionGroup,base.productionGroup);
});

test('history explains uncertainty, interrupted attempts and confirmation limits',async()=>{
  const f=await uiFixture();
  const explain=status=>vm.runInContext('deliveryExplanation('+JSON.stringify(status)+')',f.context);
  assert.match(explain('sent'),/não comprova leitura/);
  assert.match(explain('server_accepted'),/não comprova leitura/);
  assert.match(explain('uncertain'),/não repete/);
  assert.match(explain('attempting'),/interrupção/);
  assert.match(explain('not_started'),/outras tentativas/);
  assert.match(explain('unexpected'),/não comprova entrega/);
});
test('UI surfaces intersecting server changes and explicitly recovers the form',async()=>{
  const f=await uiFixture();f.el('student-lines').value='1. Unsaved fixture';f.el('settings-form').oninput();
  f.state.config.studentLines=['1. External fixture'];await f.refresh();
  assert.equal(f.el('form-conflict').hidden,false);await f.submit();
  assert.deepEqual(f.state.config.studentLines,['1. External fixture']);assert.equal(f.el('student-lines').value,'1. Unsaved fixture');
  await f.el('form-reload').onclick();assert.equal(f.el('student-lines').value,'1. External fixture');assert.equal(f.el('form-conflict').hidden,true);
});

test('reload preserves edits made after confirmation while the query is pending',async()=>{
  const f=await uiFixture();f.el('student-lines').value='1. Initial draft';f.el('settings-form').oninput();
  f.state.beforeDashboard=async()=>{f.el('student-lines').value='1. Later draft';f.el('settings-form').oninput();f.state.beforeDashboard=null;};
  await f.el('form-reload').onclick();
  assert.equal(f.el('student-lines').value,'1. Later draft');
  assert.match(f.el('toast').textContent,/preservada/);
  assert.deepEqual(f.state.config.studentLines,base.studentLines);
  await f.submit();assert.deepEqual(f.state.config.studentLines,['1. Later draft']);
});
test('offline UI refresh reports failure, never a success toast',async()=>{
  const f=await uiFixture();f.state.offline=true;await f.el('refresh').onclick();
  assert.equal(f.el('connection-warning').hidden,false);assert.notEqual(f.el('toast').textContent,'Estado atualizado.');assert.equal(f.el('toast').textContent,'fixture offline');
});

test('offline controls block operations, preserve edits and recover on refresh',async()=>{
  const f=await uiFixture();f.el('student-lines').value='1. Unsaved offline';f.el('settings-form').oninput();
  f.state.offline=true;await f.el('refresh').onclick();
  for(const id of ['wa-check','wa-pair','wa-disable','wa-production','wa-test','test-open']) assert.equal(f.el(id).disabled,true,id);
  assert.equal(f.el('wa-status').textContent,'Sem consulta atual');
  assert.equal(f.el('student-lines').value,'1. Unsaved offline');
  f.state.offline=false;await f.refresh();
  assert.equal(f.el('test-open').disabled,false);
  assert.equal(f.el('student-lines').value,'1. Unsaved offline');
});

test('native fetch failure is explained locally without claiming current health',async()=>{
  const f=await uiFixture();f.state.networkFailure=true;await f.el('refresh').onclick();
  assert.match(f.el('toast').textContent,/Sem comunicação/);
  assert.equal(f.el('health-label').textContent,'Sem consulta atual');
  assert.equal(f.el('test-open').disabled,true);
  f.state.networkFailure=false;await f.refresh();
  assert.equal(f.el('health-label').textContent,'Saudável');
});

test('offline enable action does not reenable a control with stale state',async()=>{
  const f=await uiFixture();f.state.offline=true;await f.el('refresh').onclick();
  await f.el('toggle-enabled').onclick();
  assert.equal(f.el('connection-warning').hidden,false);
  assert.equal(f.el('toggle-enabled').disabled,true);
  assert.equal(f.el('toast').textContent,'fixture offline');
});
