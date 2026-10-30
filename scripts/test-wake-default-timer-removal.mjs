import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {buildWakeGuidance} from '../plugins/qq-components/life-wake-reasons/guidance.js';
const retired=['recommendedDefaultInfinite','recommendedSleepMinMs','recommendedSleepMaxMs'];
const legacy={recommendedDefaultInfinite:false,recommendedSleepMinMs:1,recommendedSleepMaxMs:1};

test('old finite defaults cannot create a background expiry wake',async()=>{
 const h=await bridgeHarness({config:{socialV2:{wake:{...legacy,preSleepWaitEnabled:false}}}});
 try{h.setMode('reserved2');const st=h.getSocialV2State('group:456');assert.equal(st.wakeConfig.infinite,true);assert.equal(st.wakeConfig.sleepUntil,null);for(const key of retired)assert.equal(Object.hasOwn(h.cfg.socialV2.wake,key),false,key);}
 finally{await h.close();}
});
test('finite wake requires an explicit time, while an explicitly requested time still works',async()=>{
 const h=await bridgeHarness({config:{socialV2:{wake:{preSleepWaitEnabled:false,sleepMinMs:0}}}});h.setMode('reserved2');
 const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 const post=async(path,body)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{'content-type':'application/json','x-console-token':'fixture-console-token'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 try{
  const key='group:456';h.getSocialV2State(key);
  const missing=await post('/api/socialV2/wake-config',{key,config:{infinite:false}});assert.equal(missing.status,400);
  const explicit=await post('/api/socialV2/wake-config',{key,config:{infinite:false,sleepMs:600000}});assert.equal(explicit.status,200);assert.equal(h.getSocialV2State(key).wakeConfig.infinite,false);assert.ok(Date.parse(h.getSocialV2State(key).wakeConfig.sleepUntil)>Date.now());
  const rejected=await post('/api/socialV2/config',{wake:{recommendedDefaultInfinite:false}});assert.equal(rejected.status,400);
  const saved=await post('/api/socialV2/config',{wake:{recommendedHint:'保持简短'}});assert.equal(saved.status,200);assert.equal(h.getSocialV2State(key).wakeConfig.confirmedBy,'set_wake_config','saving defaults must not cancel an explicit timed wake');
 }finally{await new Promise(r=>server.close(r));await h.close();}
});
test('console and generated guidance no longer offer a separate default expiry timer',()=>{
 const page=fs.readFileSync(new URL('../console/layers/L/pages/setting-l-0.html',import.meta.url),'utf8');
 for(const field of ['v2RecDefaultInfinite','v2RecSleepMin','v2RecSleepMax'])assert.ok(!page.includes(field),field);
 const guidance=buildWakeGuidance({...legacy,recommendedProbability:0.15});assert.ok(!guidance.includes('推荐有限潜水'));assert.ok(guidance.includes('发送与等待'));assert.ok(guidance.includes('定时冒泡'));assert.ok(guidance.includes('日程提醒'));
});
test('restart drops a saved default expiry but retains a saved explicitly configured wake',async()=>{
 const until=new Date(Date.now()+3600000).toISOString();
 const h=await bridgeHarness({files:{'state/social-v2.json':{conversations:{'group:456':{bootstrapSent:true,wakeConfig:{mode:'diving',infinite:false,sleepUntil:until,confirmedBy:'default'}},'private:123':{bootstrapSent:true,wakeConfig:{mode:'diving',infinite:false,sleepUntil:until,confirmedBy:'set_wake_config'}}}}}});
 try{const automatic=h.socialV2.conversations.get('group:456').wakeConfig,explicit=h.socialV2.conversations.get('private:123').wakeConfig;assert.equal(automatic.infinite,true);assert.equal(automatic.sleepUntil,null);assert.equal(explicit.infinite,false);assert.equal(explicit.sleepUntil,until);}
 finally{await h.close();}
});
