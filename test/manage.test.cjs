'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const source=fs.readFileSync(path.join(__dirname,'../manage.cjs'),'utf8');
const files=[...source.match(/const files = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
test('deployment manifest resolves every distributed file in the real checkout',()=>{
  const root=path.resolve(__dirname,'..');
  for(const file of files) {
    if(file==='config.json') {
      assert.equal(fs.statSync(path.join(root,'config.example.json')).isFile(),true);
      continue;
    }
    assert.equal(fs.existsSync(path.join(root,file)),true,`Missing deployment file: ${file}`);
    assert.equal(fs.statSync(path.join(root,file)).isFile(),true,file);
  }
});
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rota-manage-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const candidate=path.join(root,'backups/legacy');
  for(const folder of [root,candidate]) for(const file of files) {
    const target=path.join(folder,file);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,file==='config.json'?'{"sendingEnabled":false}':file.endsWith('.json')?'{}':'');
  }
  fs.writeFileSync(path.join(root,'manage.cjs'),source);
  fs.mkdirSync(path.join(root,'socket/node_modules'),{recursive:true});
  // Avoid platform-specific symlink creation in the deployment fixture.
  fs.mkdirSync(path.join(candidate,'socket/node_modules'),{recursive:true});
  return {root,candidate};
}
test('rollback accepts legacy versions without the new health module',t=>{
  const {root,candidate}=fixture(t);
  for(const file of ['src/native-client.cjs','src/health.cjs','test/health.test.cjs']) fs.unlinkSync(path.join(candidate,file));
  const result=spawnSync(process.execPath,['manage.cjs','rollback','legacy'],{cwd:root,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/"updated":true/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'config.json'))).sendingEnabled,false);
});
test('rollback rejects a candidate requiring a missing health module',t=>{
  const {root,candidate}=fixture(t);
  fs.writeFileSync(path.join(candidate,'service.cjs'),"require('./src/health.cjs');");
  fs.unlinkSync(path.join(candidate,'src/health.cjs'));
  const result=spawnSync(process.execPath,['manage.cjs','rollback','legacy'],{cwd:root,encoding:'utf8',timeout:30000});
  assert.equal(result.status,1);
  assert.match(result.stderr,/Modulo de saude/);
  assert.equal(fs.readFileSync(path.join(root,'service.cjs'),'utf8'),'');
});
