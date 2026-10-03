'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {executorHealthy,supervisorPid}=require('../src/health.cjs');
const now=Date.parse('2026-10-03T12:00:00Z');
const base={schedulerRunning:true,pid:42,heartbeat:{pid:42,timestamp:new Date(now).toISOString()},supervisionStatus:0,supervisionPid:42,now};
test('supervisor parser accepts running service and rejects unavailable or down service',()=>{
  assert.equal(supervisorPid('run: /home/runtime/services/whatsapp: (pid 42) 151s\n'),42);
  for(const output of [undefined,'','down: whatsapp: 0s, normally up','fail: whatsapp: (pid 42)']) assert.equal(supervisorPid(output),null);
});
test('executor health requires matching live process heartbeat and supervisor',()=>{
  assert.equal(executorHealthy(base),true);
  for(const changes of [{schedulerRunning:false},{pid:43},{heartbeat:null},{supervisionStatus:1},{supervisionPid:null},{supervisionPid:43},{pid:1}]) assert.equal(executorHealthy({...base,...changes}),false);
});
test('executor health rejects stale, future and malformed timestamps',()=>{
  for(const timestamp of [new Date(now-240000).toISOString(),new Date(now+1).toISOString(),'invalid']) assert.equal(executorHealthy({...base,heartbeat:{pid:42,timestamp}}),false);
  assert.equal(executorHealthy({...base,heartbeat:{pid:42,timestamp:new Date(now-239999).toISOString()}}),true);
});
