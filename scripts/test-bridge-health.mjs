import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resolveDshBase} from '../src/runtime-endpoints.mjs';
import {classifyBridge,readBridgeHealth} from '../plugins/qq-components/obs-bridge-health/health.mjs';
const good={dshReady:true,snowluma:{connected:true,accountOnline:true,good:true,lastPacketAgoMs:5000,lastDshFrameAgoMs:9999999}};
test('DSH 空闲无事件不等于断线；健康状态不泄露聊天、令牌或QQ号码',()=>{
 const result=classifyBridge({reachable:true,status:200,data:{...good,ownerQQ:'secret-qq',activity:'private-chat',token:'secret-token'}});
 assert.equal(result.verdict,'ready');assert.equal(result.needsRestart,false);
 for(const s of ['private-chat','secret-token','secret-qq'])assert.ok(!JSON.stringify(result).includes(s));
});
test('控制台鉴权拒绝和网络拒绝是不同状态',()=>{
 assert.equal(classifyBridge({reachable:true,status:401}).verdict,'auth_required');
 assert.equal(classifyBridge({reachable:false,status:0}).verdict,'console_unreachable');
});
test('DSH不可用、QQ离线、上游退化、过期心跳分别指出问题而不建议反复重启',()=>{
 for(const [data,expected] of [[{...good,dshReady:false},'dsh_unavailable'],[{...good,snowluma:{...good.snowluma,accountOnline:false}},'qq_offline'],[{...good,snowluma:{...good.snowluma,good:false,degraded:true}},'upstream_degraded'],[{...good,snowluma:{...good.snowluma,lastPacketAgoMs:100000}},'transport_stale']]){
  const r=classifyBridge({reachable:true,status:200,data});assert.equal(r.verdict,expected);assert.equal(r.needsRestart,false);
 }
 assert.equal(classifyBridge({reachable:true,status:200,data:{}}).verdict,'unknown');
});
test('端点按显式参数、环境、当前配置选择；不把动态桌面地址误当固定3080',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-health-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({dsh:{baseUrl:'http://127.0.0.1:64601'}}));
 assert.equal(resolveDshBase({root,env:{}}),'http://127.0.0.1:64601');
 assert.equal(resolveDshBase({root,env:{DSH_BASE_URL:'http://127.0.0.1:40001'}}),'http://127.0.0.1:40001');
 assert.equal(resolveDshBase({root,env:{DSH_BASE_URL:'http://127.0.0.1:40001'},explicit:'http://127.0.0.1:40002'}),'http://127.0.0.1:40002');
});
test('健康探针只访问认证过的本机控制台，不抓群聊正文或对外发送令牌',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-health-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'state'));fs.writeFileSync(path.join(root,'state/console-token'),'private-console-key');fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({consolePort:3109}));
 const calls=[];const r=await readBridgeHealth({root,fetchFn:async(url,opts)=>{calls.push({url,opts});return {status:200,ok:true,json:async()=>good};}});
 assert.equal(r.verdict,'ready');assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:3109/api/status');assert.equal(calls[0].opts.headers['x-console-token'],'private-console-key');assert.ok(!JSON.stringify(r).includes('private-console-key'));
});
test('配置里的合法手动token优先于旧state token，与真实bridge一致',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-health-auth-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'state'));fs.writeFileSync(path.join(root,'state/console-token'),'old_persisted_key_123');
 for(const configured of ['configured_console_key_123','short']){
  fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({consoleToken:configured}));let sent;
  await readBridgeHealth({root,fetchFn:async(_,o)=>{sent=o.headers['x-console-token'];return{ok:true,status:200,json:async()=>good};}});
  assert.equal(sent,configured==='short'?'old_persisted_key_123':configured);
 }
});
test('已响应的畸形JSON或重定向是未知，不能报控制台不可达或向外转发凭据',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-health-body-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'config.json'),'{}');
 const bad=await readBridgeHealth({root,fetchFn:async()=>({ok:true,status:200,json:async()=>{throw SyntaxError('bad json');}})});assert.equal(bad.verdict,'unknown');
 const redirect=await readBridgeHealth({root,fetchFn:async(_,o)=>{assert.equal(o.redirect,'manual');return{ok:false,status:302};}});assert.equal(redirect.verdict,'unknown');
});
test('本地配置损坏是未知而不是服务掉线，DSH探针不得静默退回3080',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-bad-config-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'config.json'),'{bad');
 assert.equal((await readBridgeHealth({root,fetchFn:()=>{throw Error('must not fetch');}})).verdict,'unknown');
 assert.throws(()=>resolveDshBase({root,env:{}}),/DSH_CONFIG_UNREADABLE_OR_INVALID/);
 assert.equal(resolveDshBase({root,env:{},explicit:'http://127.0.0.1:40001'}),'http://127.0.0.1:40001');
});
