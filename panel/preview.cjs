'use strict';
// Isolated UI development fixture. It cannot contact or send to WhatsApp.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const model = require('./model.cjs');
const { createPanel } = require('./server.cjs');
const root = path.resolve(__dirname,'../runtime/panel-preview');
const password = 'preview-rota-local-123';
const salt = 'local-ui-fixture';
const config = JSON.parse(fs.readFileSync(path.resolve(__dirname,'../config.example.json'),'utf8'));
model.durableWrite(path.join(root,'config.json'),{...config,sendingEnabled:true});
model.durableWrite(path.join(root,'runtime/panel-auth.json'),{salt,hash:crypto.scryptSync(password,salt,64).toString('hex')});
model.durableWrite(path.join(root,'runtime/state.json'),{version:1,deliveries:{'2026-10-02|Rota':{timestamp:'2026-10-02T05:00:10.000Z',confirmedAt:'2026-10-02T05:00:12.000Z',status:'sent',group:config.productionGroup,messageId:'FIXTURE-NOT-A-REAL-MESSAGE'}}});
let waState={status:'unknown',groups:[]};
createPanel({root,host:'127.0.0.1',port:8788,service:async()=>({healthy:true,schedulerRunning:true,heartbeatAgeSeconds:8}),sendTest:async()=>({status:'server_accepted'}),whatsapp:{status:()=>waState,start:()=>{waState={status:'verified',active:false,timestamp:new Date().toISOString(),groups:[{id:'123@g.us',name:'Grupo Exemplo da Rota'},{id:'456@g.us',name:'Grupo Exemplo da Rota'},{id:'789@g.us',name:'Grupo'}]};return waState;},close(){}}}).then(()=>console.log('Preview isolado: http://127.0.0.1:8788 (dados fictícios; vinculação simulada sem QR real)'));
