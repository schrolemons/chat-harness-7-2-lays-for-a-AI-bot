import test from 'node:test';
import assert from 'node:assert/strict';
import {presetBindings,summarizePreset} from '../src/console/preset-overview.js';
import {bridgeHarness} from './audit-bridge-harness.mjs';
test('owner ordinary chat follows v2 until admin is enabled; mappings are whole-session bindings',()=>{
  const base={mode:'reserved2',defaultPreset:'cordis',ownerLoadedPreset:'qq-chat-v2',ownerHasSession:true};
  let rows=presetBindings({...base,admin:{enabled:false,preset:'qq-admin'}});
  assert.equal(rows.find(r=>r.key==='owner').preset,'qq-chat-v2');
  assert.equal(rows.find(r=>r.key==='admin').active,false);
  assert.equal(rows.find(r=>r.key==='v2').edit.page,'persona');
  assert.equal(rows.find(r=>r.key==='v1').edit.page,'overview');
  rows=presetBindings({...base,admin:{enabled:true,preset:'qq-admin'}});
  assert.equal(rows.find(r=>r.key==='owner').preset,'qq-admin');
  rows=presetBindings({...base,admin:{enabled:true,preset:''}});
  assert.equal(rows.find(r=>r.key==='owner').preset,'qq-admin');
  assert(rows.filter(r=>['task','learning','summary'].includes(r.key)).every(r=>!r.edit));
});
test('safe configuration summary reads tool/compaction facts without returning prompts or arbitrary config',()=>{
  const result=summarizePreset('- id: persona\n  name: "@deepseek-ai/dsh-persona"\n  config:\n    prefix: PRIVATE ROLE TEXT\n- id: fs\n  name: "@deepseek-ai/dsh-tool-fs"\n  config:\n    apiKey: secret-fixture\n    enabled: !!js process.platform === "win32"\n');
  assert(result.features.includes('本机文件读写与搜索'));
  assert(!JSON.stringify(result).includes('PRIVATE'));assert(!JSON.stringify(result).includes('secret-fixture'));
});

test('native instance wrappers expose loaded compaction and memory facts without private config',()=>{
 const content='- id: instance\n  config:\n    plugins:\n      - name: /runtime/qq-agent-presets/default-compaction.mjs\n        config: {maxContextTokens: 65536, retainTokens: 6000, maxTokens: 2048}\n      - name: /runtime/memory-tool-restrict.mjs\n        config: {secret: never-expose}\n';
 const result=summarizePreset(content);assert.equal(result.moduleCount,3);assert(result.features.some(s=>s.includes('聊天预算 65536 tokens')));assert(result.features.some(s=>s.includes('记忆整理')));assert(!JSON.stringify(result).includes('never-expose'));
});
test('overview route is console-only and returns declarations and mappings without exposing document content',async()=>{
  const h=await bridgeHarness();let server;
  const ok=value=>({result:{ok:true,value}});
  try {
    h.setMode('reserved2');h.api.agentPresets={list:async()=>ok({presets:[{id:'cordis',isDefault:true},{id:'qq-chat-v2',name:'二代仿真'}]})};
    h.api.callUnary=async()=>ok({name:'测试配置',content:'- id: persona\n  name: "@deepseek-ai/dsh-persona"\n  config: {prefix: private-fixture}'});
    const group=h.getSocialV2State('group:456');
    server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
    const url='http://127.0.0.1:'+server.address().port+'/api/presets/overview';
    const response=await fetch(url,{headers:{'x-console-token':'fixture-console-token'}});assert.equal(response.status,200);
    const data=await response.json();assert.equal(data.ok,true);assert.equal(data.bindings.length,9);assert(data.bindings.some(b=>b.key==='memory'&&b.preset==='qq-memory-worker'));assert(!JSON.stringify(data).includes('private-fixture'));
    assert.equal((await fetch(url,{headers:{'x-console-token':'fixture-console-token','x-agent-call':'1','x-agent-token':group.agentToken}})).status,403);
  }finally{if(server)await new Promise(r=>server.close(r));await h.close();}
});
