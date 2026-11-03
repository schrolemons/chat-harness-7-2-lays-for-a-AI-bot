import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {bridgeHarness} from './audit-bridge-harness.mjs';

test('Console editing v2 rebuilds both bundle presets; invalid shared edits roll back both',async()=>{
 const h=await bridgeHarness();let server;
 try{
  const packageIdentity={name:'synthetic-preset-install',qqBridge:{instance:{entryId:'synthetic-mode',settingsNamespace:'synthetic-mode'}}};
  fs.writeFileSync(path.join(h.temp,'package.json'),JSON.stringify(packageIdentity));
  h.setMode('reserved2');server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port,headers={'x-console-token':'fixture-console-token','content-type':'application/json'};
  const api=async(route,body)=>{const r=await fetch(base+route,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,...await r.json()};};
  const initial=await api('/api/preset/sim-prompt');assert.equal(initial.ok,true);
  const content=initial.content+'\n【同步回归】new shared conversation rule';
  const saved=await api('/api/preset/sim-prompt',{content});assert.equal(saved.ok,true,JSON.stringify(saved));assert.equal(saved.requiresRestart,true);
  const artifact=path.join(h.temp,'plugins/qq-agent-presets/presets/qq-admin.patch.yml');
  const before=fs.readFileSync(artifact,'utf8');const rows=yaml.load(before)[0].insert[0].config.plugins;
  assert(rows.find(row=>row.id==='persona').config.prefix.includes('new shared conversation rule'));
  const rootArtifact=path.join(h.temp,'cordis.patch.yml'),rootBefore=fs.readFileSync(rootArtifact,'utf8');
  assert.deepEqual(yaml.load(rootBefore),[{insert:[{id:'synthetic-mode',name:packageIdentity.name,config:{}}]}]);
  const v2Artifact=path.join(h.temp,'plugins/qq-agent-presets/presets/qq-chat-v2.patch.yml'),v2Before=fs.readFileSync(v2Artifact,'utf8');
  assert(yaml.load(v2Before)[0].insert[0].config.plugins.find(row=>row.id==='persona').config.prefix.includes('new shared conversation rule'),'the instance-loaded v2 definition follows the same shared source');
  const invalid=await api('/api/preset/sim-prompt',{content:content.replace('【二代仿真模式 —— 工具协议','【invalid shared section')});
  assert.equal(invalid.ok,false);assert.equal(fs.readFileSync(artifact,'utf8'),before);
  assert.equal(fs.readFileSync(rootArtifact,'utf8'),rootBefore);
  assert.equal(fs.readFileSync(v2Artifact,'utf8'),v2Before);
  const readback=await api('/api/preset/sim-prompt');assert.equal(readback.content,content);
 }finally{if(server)await new Promise(r=>server.close(r));await h.close();}
});
