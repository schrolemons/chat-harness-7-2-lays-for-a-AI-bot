import test from 'node:test';import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
test('balance query gate binds owner/private/group to authenticated conversation and rejects spoofed identity',async()=>{
 const h=await bridgeHarness({config:{allow:{private:['123','124'],groups:['456']}}});let server;
 try{
  h.setMode('reserved2');const seen=[];const original=h.pluginHost.callTool.bind(h.pluginHost);
  h.pluginHost.callTool=async(name,input)=>{if(name!=='deepseek_balance')return original(name,input);seen.push(input);return {ok:true,result:input.callerKey==='private:123'?{balance_infos:[{total_balance:'12.34'}]}:{milk:{stock:{stage:'low'}}}};};
  server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
  const call=async(key,token)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/plugins/call',{method:'POST',headers:{'content-type':'application/json','x-console-token':'fixture-console-token','x-agent-token':token||h.getSocialV2State(key).agentToken},body:JSON.stringify({tool:'deepseek_balance',input:{callerKey:'private:123',key:'private:123'}})});return {status:r.status,data:await r.json()};};
  for(const key of ['private:124','group:456']){const r=await call(key);assert.equal(r.status,200);assert.equal(seen.at(-1).callerKey,key);assert(!JSON.stringify(r.data).includes('12.34'));assert.deepEqual(Object.keys(seen.at(-1)),['callerKey']);}
  assert.equal((await call('private:123')).status,200);assert.equal((await call('group:789')).status,403);assert.equal((await call('group:456','invalid-token')).status,403);assert.equal(seen.length,3);
 }finally{if(server){server.closeAllConnections?.();await new Promise(r=>server.close(r));}await h.close();}
});
