import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeHarness,fixtureTaskTurn} from './audit-bridge-harness.mjs';
import {apply} from '../plugins/qq-agent-presets/qq-tool-restrict.mjs';
import {isAdminPluginTool} from '../src/tools/admin-policy.js';
test('ordinary schemas and execution deny operational tools; chat task notes remain usable',()=>{
  const names=['mcp__snowluma__qq_task_spawn','mcp__snowluma__qq_task_list','mcp__snowluma__qq_task_result','mcp__snowluma__qq_task_input','mcp__snowluma__qq_task_cancel','mcp__snowluma__web_watch_status','mcp__snowluma__user_checking','mcp__snowluma-host__snowluma_status'];
  const denied=new Set();let guard;
  apply({tools:{schemas:()=>names.map(name=>({name})),restrict:({deny})=>{for(const n of deny)denied.add(n);},guard:fn=>guard=fn},on:()=>{}});
  for(const name of names){assert(denied.has(name),name);assert(guard({name}),name);}
  assert.equal(guard({name:'mcp__snowluma__qq_task_note'}),undefined);
  assert.equal(guard({name:'mcp__snowluma__qq_send_message'}),undefined);
});
test('real plugin route rejects private/group tokens and forged owner fields before reading management data',async()=>{
  const h=await bridgeHarness({config:{allow:{private:['123','789'],groups:['456']}}});let server;
  try {
    h.setMode('reserved2');
    h.cfg.socialV2.adminDev={enabled:true,preset:'qq-admin'};h.setPresets(['standard','qq-chat-v2','qq-admin']);
    await h.ensureSession('private:123');
    const owner=h.getSocialV2State('private:123'),other=h.getSocialV2State('private:789'),group=h.getSocialV2State('group:456');
    await fixtureTaskTurn(h,'private:123');
    const admittedSessionCount=h.calls.created.length;
    server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
    const call=(tool,token)=>fetch('http://127.0.0.1:'+server.address().port+'/api/plugins/call',{method:'POST',headers:{'content-type':'application/json','x-console-token':'fixture-console-token','x-agent-call':'1','x-agent-token':token},body:JSON.stringify({tool,input:{token,callerKey:'private:123',key:'private:123',isOwnerKey:true}})});
    for(const state of [other,group])for(const tool of ['web_watch_status','task_spawn','task_list','task_result','task_input','task_cancel','user_checking','bridge_health_help','worklog_history','exec_backends']) {
      const response=await call(tool,state.agentToken);assert.equal(response.status,403,tool);
      const data=await response.json();assert.deepEqual(Object.keys(data).sort(),['error','ok']);
    }
    assert.equal((await call('task_list',owner.agentToken)).status,200);
    assert.equal(h.calls.created.length,admittedSessionCount);assert.equal(h.calls.sent.length,0);
  } finally {if(server)await new Promise(r=>server.close(r));await h.close();}
});
