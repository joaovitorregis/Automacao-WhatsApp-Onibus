'use strict';
// Executed from a staged release, under runtime/automation.guard.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const target = '/data/data/com.termux/files/home/whatsapp-onibus-rota-1-android';
const stage = path.resolve(__dirname,'..');
if (!stage.startsWith(target + '/.incoming/')) throw Error('Instalador deve executar a partir da área de preparação.');
const files = ['panel/model.cjs','panel/server.cjs','panel/run.sh','panel/install.cjs','panel/public/index.html','panel/public/app.js','panel/public/style.css','panel/public/icon.svg','socket/test-send.mjs','test/panel.test.cjs'];
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const protectedFiles = ['config.json','runtime/state.json'];
const before = protectedFiles.map(file => digest(path.join(target,file)));
for (const file of files) if (!fs.statSync(path.join(stage,file)).isFile()) throw Error('Arquivo candidato ausente: '+file);
const backup = path.join(target,'backups','panel-'+Date.now());
fs.mkdirSync(backup,{recursive:true,mode:0o700});
const service = path.join(target,'runtime/services/rota-panel');
const existed = fs.existsSync(service);
if (existed) {
  const stopped = spawnSync('sv',['-w','10','down',service],{encoding:'utf8',timeout:15000});
  if (stopped.status !== 0) throw Error('Não foi possível pausar o painel antigo; instalação cancelada.');
}
const installed = [];
try {
  for (const file of files) {
    const destination = path.join(target,file), old = path.join(backup,file);
    if (fs.existsSync(destination)) { fs.mkdirSync(path.dirname(old),{recursive:true,mode:0o700}); fs.copyFileSync(destination,old); }
    fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
    const temporary = destination + '.panel-install.tmp';
    fs.copyFileSync(path.join(stage,file),temporary); fs.chmodSync(temporary,file.endsWith('.sh')?0o700:0o600);
    fs.renameSync(temporary,destination); installed.push(file);
  }
  protectedFiles.forEach((file,i) => { if (digest(path.join(target,file)) !== before[i]) throw Error('Estado protegido mudou durante a instalação.'); });
  fs.mkdirSync(service,{recursive:true,mode:0o700});
  fs.copyFileSync(path.join(target,'panel/run.sh'),path.join(service,'run')); fs.chmodSync(path.join(service,'run'),0o700);
  if (existed) spawnSync('sv',['up',service],{timeout:15000});
  console.log(JSON.stringify({installed:true,backup:path.basename(backup),configPreserved:true,statePreserved:true}));
} catch(error) {
  for(const file of installed.reverse()) {
    const old=path.join(backup,file), destination=path.join(target,file);
    if(fs.existsSync(old)) fs.copyFileSync(old,destination); else fs.unlinkSync(destination);
  }
  if(existed) spawnSync('sv',['up',service],{timeout:15000});
  throw error;
}
