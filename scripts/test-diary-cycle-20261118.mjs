import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createPlugin} from '../plugins/qq-components/ctx-memory-store/index.js';
const key='private:10006',group='group:40001',day='2026-11-17',bell=Date.parse(day+'T22:00:00+08:00');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'diary-cycle-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let state={},plugin;const receipts=new Map(),sent=[],calls=[];
 const ctx={root,config:{},state:{get:()=>state,set:p=>state={...state,...p}},log(){},warn(){},callService:(s,m,p)=>plugin.services[s]?.[m]?.(p),capabilities:{now:()=>bell,runtimeStartedAt:bell-3600000,memoryConfig:()=>({enabled:true,updateIntervalMin:60,dailyDiary:{enabled:true,hour:22,minute:0,maxChars:500}}),listConversationKeys:()=>[key,group],memoryWorkerContext:k=>({role:'AI助手',messages:[{seq:1,userId:k.split(':')[1],sender:'本人',at:bell-3600000,text:'今天爱喝酸奶'}]}),runReadOnlyWorker:async p=>{calls.push(p);return {text:'今天用户说爱喝酸奶。',sessionId:'isolated'};},deliveryStatus:async id=>({ok:true,status:receipts.has(id)?'sent':'absent',finishedAt:receipts.get(id)}),sendDiaryDelivery:async(k,body,meta)=>{sent.push({key:k,body,meta});receipts.set(meta.id,Date.now());return {ok:true,receiptStatus:'sent'};},requestMemoryWrite:()=>false}};
 plugin=createPlugin(ctx);return {ctx,plugin,m:plugin.services.memory,worker:plugin.services.diaryWorker,sent,calls,state:()=>state};}
test('private and group diary draft during the day and regenerate at the bell before delivering once',async t=>{
 const f=fixture(t);for(const k of [key,group])f.plugin.hooks.onIncoming({key:k});
 // Supply real activity timestamps for this reproduced calendar day.
 f.ctx.state.set({lastIncomingAt:{[key]:bell-3600000,[group]:bell-3600000}});
 await f.plugin.hooks.onTick({now:bell-20*60000});await Promise.all([key,group].map(k=>f.worker.whenIdle({key:k})));
 assert.equal(f.calls.length,2);assert.equal(f.sent.length,0);assert.match(f.m.diaryArchiveRead({date:day}).text,/爱喝酸奶/);
 await f.plugin.hooks.onTick({now:bell});await Promise.all([key,group].map(k=>f.worker.whenIdle({key:k})));assert.equal(f.calls.length,4);assert.equal(f.sent.length,2);assert(f.sent.every(x=>x.meta.expiresAt===bell+5*60000));
 await f.plugin.hooks.onTick({now:bell+60000});assert.equal(f.sent.length,2);
});
test('no human activity on the diary date means no new diary even if the bot spoke or an old diary exists',async t=>{
 const f=fixture(t);f.ctx.capabilities.memoryWorkerContext=()=>({messages:[{at:bell-1000,isSelf:true,text:'自言自语'},{at:bell-86400000,text:'昨天来信'}]});
 await f.plugin.hooks.onTick({now:bell-1000});await f.plugin.hooks.onTick({now:bell});assert.equal(f.calls.length,0);assert.equal(f.sent.length,0);
});
test('a missed deadline never sends randomly next morning; catch-up uses only this QQ archived history',async t=>{
 const f=fixture(t);f.m.updateDiary({key,day,text:'已归档的十七日日记',now:bell-1000});
 await f.plugin.hooks.onTick({now:bell+12*3600000});assert.equal(f.sent.length,0);
 const empty=await f.m.catchUpDiaries({key:group,now:bell+12*3600000});assert.deepEqual(empty.results,[]);
 const result=await f.m.catchUpDiaries({key,now:bell+12*3600000});assert.equal(result.results.length,1);assert.equal(f.sent.length,1);assert.equal(f.sent[0].key,key);assert.match(f.sent[0].body,/十七日/);assert.equal(f.calls.length,0);
});
test('bot can see dated history after the window rolls, edit that same QQ draft, and reconcile a manual send receipt',async t=>{
 const f=fixture(t);f.m.updateDiary({key,day,text:'原稿',now:bell-1000});
 const current=f.m.diaryCurrent({key,now:bell+1000});assert.equal(current.text,'');assert(current.history.some(x=>x.day===day));
 const old=f.m.diaryCurrent({key,day,now:bell+1000});assert.equal(old.text,'原稿');assert(old.revision);
 assert.equal(f.m.updateDiary({key,day,text:'修订稿',revision:old.revision,now:bell+1000}).ok,true);
 assert.equal(f.m.updateDiary({key:group,day,text:'串人',revision:old.revision,now:bell+1000}).ok,false);
 await f.m.sendDiaryDetailed({key,day,now:bell+1000,manualRequestId:'manual-history-01'});
 const status=await f.m.diaryStatus({key,now:bell+1000});assert.equal(status.previousDiaryStatus,'sent');
 assert.match(f.sent[0].body,/修订稿/);
});

test('restart interrupts the old diary job without leaving buttons or pre-bell preparation locked',async t=>{
 const f=fixture(t);f.ctx.state.set({diaryWorkerJobs:{[key]:{status:'running',day,throughAt:bell-3600000}},lastIncomingAt:{[key]:bell-3600000}});
 const reloaded=createPlugin(f.ctx);assert.equal(reloaded.services.diaryWorker.status({key}).status,'interrupted');
 await reloaded.hooks.onTick({now:bell-20*60000});await reloaded.services.diaryWorker.whenIdle({key});
 assert.equal(reloaded.services.diaryWorker.status({key}).status,'completed');assert.equal(f.calls.length,1);
});
