'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
// Connections are explicit, bounded and share the sender's kernel guard.
function createWhatsApp(root,{launch=execFile,now=Date.now}={}) {
  let current = null, child = null, lastStart = -Infinity;
  function status() {
    if (!current) return {status:'unknown',groups:[]};
    let value;
    try { value=JSON.parse(fs.readFileSync(current.file,'utf8')); } catch { value={status:'checking'}; }
    const age=now()-Date.parse(value.timestamp);
    const fresh=Number.isFinite(age) && age>=0 && age<300000;
    return {status:current.failed?'failed':fresh?value.status:child?'checking':'expired',
      timestamp:value.timestamp, active:!!child,
      groups:fresh && value.status==='verified' && !current.failed && !child ? value.groups || []:[],
      qr:fresh && value.status==='qr' && child && !current.failed ? value.qr:undefined};
  }
  function start(mode) {
    if (child) throw Object.assign(Error('Já existe uma verificação ou vinculação em andamento.'),{status:409});
    if (!['check','pair'].includes(mode)) throw Object.assign(Error('Ação inválida.'),{status:400});
    if(now()-lastStart<30000) throw Object.assign(Error('Aguarde 30 segundos antes de verificar novamente.'),{status:429});
    lastStart=now();
    const id=crypto.randomUUID();
    current={file:path.join(root,'socket/runtime',`panel-${id}.json`),failed:false};
    const job=current;
    child=launch('/data/data/com.termux/files/usr/bin/sh',[path.join(root,'socket/run.sh'),mode==='pair'?'--panel-pair':'--panel-check'],
      {cwd:root,timeout:mode==='pair'?300000:90000,killSignal:'SIGTERM',maxBuffer:131072,
        env:{...process.env,WHATSAPP_PANEL_JOB:id}},error=>{child=null;job.failed=!!error;});
    return {status:'checking',active:true,groups:[]};
  }
  return {status,start,close(){child?.kill('SIGTERM');}};
}
module.exports={createWhatsApp};
