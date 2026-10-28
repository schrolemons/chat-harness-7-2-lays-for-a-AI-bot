import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGatewayRecovery} from './gateway-recovery.mjs';

test('仅网关进程确实消失时补起；消息空闲、上游退化或 QQ 下线不触发重启', async()=>{
 let state={bridgeRunning:true,configured:true,qqRunning:true,gatewayRunning:true,http:true,ws:true};
 let starts=0;
 const recovery=createGatewayRecovery({inspect:async()=>state,recover:async()=>{starts++;}});
 for(const extra of [{},{good:false},{accountOnline:false},{lastPacketAgoMs:9999999}]){state={...state,...extra};await recovery.tick();}
 assert.equal(starts,0);
 state={...state,gatewayRunning:false,http:false,ws:false};await recovery.tick();assert.equal(starts,1);
});
test('关闭 bot 后不复活；重复检测合并为一个恢复操作',async()=>{
 let closed=false,starts=0,finish;
 const recovery=createGatewayRecovery({inspect:async()=>({bridgeRunning:!closed,configured:true,qqRunning:true,gatewayRunning:false,http:false,ws:false}),
 recover:async()=>{starts++;await new Promise(r=>{finish=r;});}});
 closed=true;await recovery.tick();assert.equal(starts,0);
 closed=false;const a=recovery.tick();const b=recovery.tick();await new Promise(r=>setTimeout(r,5));assert.equal(starts,1);finish();await Promise.all([a,b]);
});
test('恢复失败有冷却和次数上限，不无限重启；卸载会取消迟到的恢复',async()=>{
 let at=1000,starts=0;
 const recovery=createGatewayRecovery({now:()=>at,cooldownMs:100,maxAttempts:2,windowMs:1000,
 inspect:async()=>({bridgeRunning:true,configured:true,qqRunning:true,gatewayRunning:false,http:false,ws:false}),
 recover:async()=>{starts++;throw Error('fixture');}});
 await recovery.tick();await recovery.tick();assert.equal(starts,1);
 at+=101;await recovery.tick();at+=101;await recovery.tick();assert.equal(starts,2);
 let done;const pending=createGatewayRecovery({inspect:()=>new Promise(r=>{done=r;}),recover:async()=>assert.fail('disposed')});
 const tick=pending.tick();pending.dispose();done({bridgeRunning:true,configured:true,qqRunning:true,gatewayRunning:false,http:false,ws:false});await tick;
});
