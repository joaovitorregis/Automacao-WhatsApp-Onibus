'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {create,restore}=require('../scripts/recovery-snapshot.cjs');
function fixture(t) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'rota-snapshot-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const root=path.join(base,'source');fs.mkdirSync(root);
  for(const file of ['config.json','runtime/state.json','socket/auth/state.json','runtime/panel-auth.json','src/lib.cjs','runtime/services/whatsapp/run','runtime/services/rota-panel/run']) {
    fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});
    fs.writeFileSync(path.join(root,file),'{"private":"fixture"}',{mode:0o600});
  }
  return{root,snapshot:path.join(base,'backup'),restored:path.join(base,'restored')};
}
test('snapshot restores exact state, credentials and code without starting processes',t=>{
  const f=fixture(t);assert.equal(create(f.root,f.snapshot).created,true);
  const result=restore(f.snapshot,f.restored);
  assert.equal(result.started,false);assert.equal(result.verified,true);
  for(const file of ['config.json','runtime/state.json','socket/auth/state.json','runtime/panel-auth.json','src/lib.cjs','runtime/services/whatsapp/run','runtime/services/rota-panel/run']) assert.deepEqual(fs.readFileSync(path.join(f.restored,file)),fs.readFileSync(path.join(f.root,file)));
});
test('corrupt backup refuses restoration before creating destination',t=>{
  const f=fixture(t);create(f.root,f.snapshot);
  fs.writeFileSync(path.join(f.snapshot,'runtime/state.json'),'corrupt');
  assert.throws(()=>restore(f.snapshot,f.restored));assert.equal(fs.existsSync(f.restored),false);
});
test('snapshot refuses missing credentials, existing destination and overlap',t=>{
  const f=fixture(t);
  fs.mkdirSync(f.snapshot);
  assert.throws(()=>create(f.root,f.snapshot));
  fs.rmdirSync(f.snapshot);
  assert.throws(()=>create(f.root,path.join(f.root,'backup')));
  fs.unlinkSync(path.join(f.root,'socket/auth/state.json'));
  assert.throws(()=>create(f.root,f.snapshot));
  assert.equal(fs.existsSync(f.snapshot),false);
});

test('snapshot rejects external symlink ancestors',t=>{
  const f=fixture(t),base=path.dirname(f.root),external=path.join(base,'external');
  fs.mkdirSync(external);
  fs.copyFileSync(path.join(f.root,'runtime/state.json'),path.join(external,'state.json'));
  fs.copyFileSync(path.join(f.root,'runtime/panel-auth.json'),path.join(external,'panel-auth.json'));
  fs.rmSync(path.join(f.root,'runtime'),{recursive:true});
  fs.symlinkSync(external,path.join(f.root,'runtime'),'junction');
  assert.throws(()=>create(f.root,f.snapshot));
  assert.equal(fs.existsSync(f.snapshot),false);
});
test('snapshot rejects destinations aliased inside a valid source',t=>{
  const f=fixture(t),base=path.dirname(f.root);
  const alias=path.join(base,'alias');fs.symlinkSync(f.root,alias,'junction');
  assert.throws(()=>create(f.root,path.join(alias,'nested-backup')));
  assert.equal(fs.existsSync(path.join(f.root,'nested-backup')),false);
});

test('restore rejects external ancestor links even if file hashes match',t=>{
  const f=fixture(t);create(f.root,f.snapshot);
  const external=path.join(path.dirname(f.root),'external');
  fs.renameSync(path.join(f.snapshot,'runtime'),external);
  fs.symlinkSync(external,path.join(f.snapshot,'runtime'),'junction');
  assert.throws(()=>restore(f.snapshot,f.restored));
  assert.equal(fs.existsSync(f.restored),false);
});
test('restore rejects path traversal manifests without changing source',t=>{
  const f=fixture(t);create(f.root,f.snapshot);
  const file=path.join(f.snapshot,'snapshot-manifest.json'),manifest=JSON.parse(fs.readFileSync(file));
  manifest.entries[0].path='../escape.json';fs.writeFileSync(file,JSON.stringify(manifest));
  assert.throws(()=>restore(f.snapshot,f.restored));assert.equal(fs.existsSync(f.restored),false);
});
