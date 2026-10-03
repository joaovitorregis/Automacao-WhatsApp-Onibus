'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {configuredRun}=require('../panel/network.cjs');
test('installation explicitly configures private binding rather than inheriting server defaults',()=>{
  const old='#!/bin/sh\nexport PANEL_HOST="127.0.0.1"\nexport PANEL_PORT="1"\nexec node server.cjs\n';
  const result=configuredRun(old,'100.64.1.2',8787);
  assert.match(result,/export PANEL_HOST="100.64.1.2"/);
  assert.match(result,/export PANEL_PORT="8787"/);
  assert.equal((result.match(/export PANEL_HOST=/g)||[]).length,1);
  assert.equal((result.match(/export PANEL_PORT=/g)||[]).length,1);
  for(const host of [undefined,'0.0.0.0','8.8.8.8','evil.example.com','host; rm']) assert.throws(()=>configuredRun(old,host,8787));
  for(const port of [0,65536,'bad']) assert.throws(()=>configuredRun(old,'a10s',port));
  assert.match(configuredRun('#!/bin/sh\nexec node server.cjs\n','a10s',8787),/PANEL_HOST="a10s"/);
});
