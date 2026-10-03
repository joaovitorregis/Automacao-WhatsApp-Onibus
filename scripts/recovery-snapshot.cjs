'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const within = (root, file) => file === root || file.startsWith(root + path.sep);
function destinationPath(input) {
  let ancestor=path.resolve(input);const suffix=[];
  for(;;) {
    try { fs.lstatSync(ancestor);break; }
    catch(error) {
      if(error.code!=='ENOENT') throw error;
      const parent=path.dirname(ancestor);if(parent===ancestor) throw Error('Destino inválido.');
      suffix.unshift(path.basename(ancestor));ancestor=parent;
    }
  }
  return path.join(fs.realpathSync(ancestor),...suffix);
}
const required = ['config.json','runtime/state.json','socket/auth/state.json','runtime/panel-auth.json'];
const directories = ['src','socket','panel','test','scripts','docs','node_modules'];
const runtimeFiles = ['state.json','panel-auth.json','panel-access.txt','panel-audit.jsonl','recovery.log','automation.jsonl'];
function scan(root) {
  const entries = [];
  function visit(relative) {
    const file=path.join(root,relative), stat=fs.lstatSync(file);
    if(!within(root,fs.realpathSync(file))) throw Error('Ancestral externo recusado.');
    if(stat.isSymbolicLink()) {
      const target=fs.realpathSync(file);
      if(!within(root,target)) throw Error('Link externo recusado.');
      entries.push({path:relative.split(path.sep).join('/'),type:'link',target:path.relative(path.dirname(file),target).split(path.sep).join('/')});
    } else if(stat.isDirectory()) {
      for(const child of fs.readdirSync(file).sort()) visit(path.join(relative,child));
    } else if(stat.isFile()) entries.push({path:relative.split(path.sep).join('/'),type:'file',sha256:hash(file),mode:stat.mode&0o777});
    else throw Error('Arquivo especial recusado.');
  }
  for(const name of fs.readdirSync(root).sort()) {
    const stat=fs.lstatSync(path.join(root,name));
    if(stat.isFile() && (/\.(cjs|mjs|json|sh|md)$/.test(name) || name.startsWith('LICENSE') || name==='start-whatsapp')) visit(name);
  }
  for(const dir of directories) if(fs.existsSync(path.join(root,dir))) {
    if(dir==='socket') {
      for(const name of fs.readdirSync(path.join(root,dir)).sort()) {
        if(name!=='runtime') visit(path.join(dir,name));
      }
      const runtime=path.join(root,'socket/runtime');
      if(fs.existsSync(runtime)) for(const name of fs.readdirSync(runtime).sort()) {
        if(name==='events.jsonl' || name==='test-send.json' || /^test-[a-f0-9-]{36}\.json$/.test(name)) visit(path.join('socket/runtime',name));
      }
    } else visit(dir);
  }
  for(const name of runtimeFiles) if(fs.existsSync(path.join(root,'runtime',name))) visit(path.join('runtime',name));
  // Preserve supervisor definitions, never transient sockets, PIDs or heartbeat.
  for(const service of ['whatsapp','rota-panel']) for(const name of ['run','down']) {
    const relative=path.join('runtime/services',service,name);
    if(fs.existsSync(path.join(root,relative))) visit(relative);
  }
  for(const file of required) if(!entries.some(e=>e.path===file && e.type==='file')) throw Error('Backup incompleto: arquivo obrigatório ausente.');
  return entries.sort((a,b)=>a.path.localeCompare(b.path));
}
function validateEntries(entries) {
  if(!Array.isArray(entries) || !entries.length) throw Error('Manifesto inválido.');
  const seen=new Set();
  for(const e of entries) {
    if(typeof e.path!=='string' || !e.path || path.isAbsolute(e.path) || e.path.split(/[\\/]/).includes('..') || seen.has(e.path)) throw Error('Caminho inválido no manifesto.');
    seen.add(e.path);
    if(e.type==='file' && (!/^[a-f0-9]{64}$/.test(e.sha256) || !Number.isInteger(e.mode) || e.mode<0 || e.mode>0o777)) throw Error('Arquivo inválido no manifesto.');
    const sandbox=path.resolve('snapshot');
    if(e.type==='link' && (typeof e.target!=='string' || path.isAbsolute(e.target) || !within(sandbox,path.resolve(sandbox,path.dirname(e.path),e.target)))) throw Error('Link inválido no manifesto.');
    if(!['file','link'].includes(e.type)) throw Error('Tipo inválido.');
  }
  for(const file of required) if(!entries.some(e=>e.path===file && e.type==='file')) throw Error('Manifesto incompleto.');
}
function verify(root, entries) {
  validateEntries(entries);
  for(const e of entries) {
    const file=path.join(root,e.path), stat=fs.lstatSync(file);
    if(!within(root,fs.realpathSync(file))) throw Error('Ancestral externo recusado.');
    if(e.type==='file' && (!stat.isFile() || stat.isSymbolicLink() || hash(file)!==e.sha256)) throw Error('Integridade divergente.');
    if(e.type==='link' && (!stat.isSymbolicLink() || fs.readlinkSync(file)!==e.target || !within(root,fs.realpathSync(file)))) throw Error('Link divergente.');
  }
}
function copy(from,to,entries) {
  if(fs.existsSync(to) || within(from,to) || within(to,from)) throw Error('Destino deve ser novo e separado da origem.');
  fs.mkdirSync(to,{recursive:true,mode:0o700});
  for(const e of entries.filter(e=>e.type==='file')) {
    const file=path.join(to,e.path);
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    fs.copyFileSync(path.join(from,e.path),file);
    fs.chmodSync(file,e.mode);
  }
  for(const e of entries.filter(e=>e.type==='link')) {
    const file=path.join(to,e.path);
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.symlinkSync(e.target,file);
  }
  verify(to,entries);
}
function create(root,destination) {
  root=fs.realpathSync(root);destination=destinationPath(destination);
  const entries=scan(root);
  copy(root,destination,entries);
  // Detect concurrent modifications; writers must already be stopped.
  verify(root,entries);
  if(JSON.stringify(scan(root))!==JSON.stringify(entries)) throw Error('Origem mudou durante o backup.');
  fs.writeFileSync(path.join(destination,'snapshot-manifest.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),entries},null,2),{flag:'wx',mode:0o600});
  return {created:true,files:entries.length,private:true};
}
function restore(snapshot,destination) {
  snapshot=fs.realpathSync(snapshot);destination=destinationPath(destination);
  const manifest=JSON.parse(fs.readFileSync(path.join(snapshot,'snapshot-manifest.json'),'utf8'));
  if(manifest.version!==1) throw Error('Versão de manifesto inválida.');
  verify(snapshot,manifest.entries);copy(snapshot,destination,manifest.entries);
  return {restored:true,verified:true,files:manifest.entries.length,started:false};
}
if(require.main===module) {
  const [action,from,to,...extra]=process.argv.slice(2);
  try {
    if(!['create','restore'].includes(action) || !from || !to || extra.length) throw Error('Argumentos inválidos.');
    console.log(JSON.stringify(action==='create'?create(from,to):restore(from,to)));
  } catch { console.error('Snapshot recusado ou incompleto; origem não alterada. Use create|restore ORIGEM DESTINO_NOVO.');process.exitCode=1; }
}
module.exports={create,restore};
