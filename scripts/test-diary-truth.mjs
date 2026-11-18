import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createPlugin} from '../plugins/qq-components/ctx-memory-store/index.js';
import {withDiaryDelivery} from './fixtures/diary-delivery.mjs';
import {diaryTargetDay,diaryWindow,diaryReceiptIds} from '../plugins/qq-components/ctx-memory-store/diary-delivery.mjs';
import {createPlugin as createUpdate} from '../plugins/qq-components/ctx-memory-update/index.js';
import {createPlugin as createContext} from '../plugins/qq-components/ctx-memory-context/index.js';
import {diaryEvidence} from '../plugins/qq-components/ctx-memory-update/diary-source.mjs';
const key='private:123',day='2026-11-01';
function fixture(t,{state={},lookup=async()=>({ok:true,status:'absent'})}={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'diary-truth-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const tools=new Map();const ctx={root,config:{},log:()=>{},warn:()=>{},state:{get:()=>state,set:patch=>Object.assign(state,patch)},capabilities:{deliveryStatus:lookup},registerTool:(name,def)=>tools.set(name,def)};return {root,state,ctx,plugin:createPlugin(ctx),tools};}
test('a last-sent date or legacy text never proves QQ delivery',async t=>{const f=fixture(t,{state:{lastDiaryDate:{[key]:day}}});f.plugin.services.affairs.appendReceipt({key,text:'日记已发：'+day});const result=await f.plugin.services.memory.diaryStatus({key,day});assert.equal(result.sentForDay,false);assert.equal(result.deliveryStatus,'legacy_unconfirmed');});
test('unconfirmed central receipts cannot inherit a legacy sent flag',async t=>{for(const status of ['claimed','uncertain']){const f=fixture(t,{state:{lastDiaryDate:{[key]:day}},lookup:async()=>({ok:true,status})});const result=await f.plugin.services.memory.diaryStatus({key,day});assert.equal(result.sentForDay,false);assert.equal(result.deliveryStatus,status);}});
test('manual diary receipt references are checked against the central ledger',async t=>{const id='diary:'+key+':'+day+':manual:manual-click-1';const f=fixture(t,{lookup:async value=>({ok:true,status:value===id?'sent':'absent',finishedAt:value===id?1793541900000:0})});f.plugin.services.affairs.appendReceipt({key,text:'通知已发：'+id+'｜2026-11-01T14:05:00Z'});const result=await f.plugin.services.memory.diaryStatus({key,day});assert.equal(result.sentForDay,true);assert.equal(result.sentAt,1793541900000);});
test('reading status does not promote legacy dates into confirmed metadata',async t=>{const f=fixture(t);f.plugin.services.affairs.appendReceipt({key,text:'日记已发：'+day});await f.plugin.services.memory.diaryStatus({key,day});assert.equal(f.state.lastDiaryDate?.[key],undefined);});

test('configured Beijing boundary changes the current window at the exact minute',()=>{
 const config={hour:18,minute:30};
 assert.equal(diaryTargetDay(Date.parse('2026-12-31T18:29:59+08:00'),config),'2026-12-31');
 assert.equal(diaryTargetDay(Date.parse('2026-12-31T18:30:00+08:00'),config),'2027-01-01');
 assert.deepEqual(diaryWindow('2027-01-01',config),{day:'2027-01-01',start:'2026-12-31 18:30',end:'2027-01-01 18:30',label:'2026-12-31 18:30 至 2027-01-01 18:30'});
});

function scheduledFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'diary-bell-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const sent=[],requests=[],now=Date.parse('2026-11-01T18:30:00+08:00'),state={lastWriteAt:{[key]:now},lastIncomingAt:{[key]:now-60000}};
 const capabilities=withDiaryDelivery(root,{now:()=>now,memoryWorkerContext:()=>({messages:[{seq:1,userId:'123',text:'今天修好了小程序。',at:now-60000}]}),runReadOnlyWorker:async()=>({text:'BEFORE_SCHEDULE'}),runtimeStartedAt:now-3600000,memoryConfig:()=>({enabled:true,dailyDiary:{enabled:true,hour:18,minute:30}}),listConversationKeys:()=>[key],requestMemoryWrite:(key,opts)=>{requests.push({key,opts});return true;},sendNotification:(key,body,meta)=>{sent.push({key,body,meta});return true;}},{now:()=>now});
 const ctx={root,config:{},state:{get:()=>state,set:patch=>Object.assign(state,patch)},log:()=>{},warn:()=>{},registerTool:()=>{},capabilities};
 return {root,state,sent,requests,now,ctx,plugin:createPlugin(ctx)};
}

test('manual delivery receipts do not consume the independent scheduled bell across reload',async t=>{
 const f=scheduledFixture(t),memory=f.plugin.services.memory;
 memory.updateDiary({key,day,now:f.now-60000,text:'PREPARED_DRAFT'});
 for(let i=0;i<3;i++)assert.equal((await memory.sendDiaryDetailed({key,day,now:f.now-60000,manualRequestId:'manual-click-'+i})).ok,true);
 assert.equal((await memory.diaryStatus({key,day})).scheduledDeliveryStatus,'absent');
 await f.plugin.hooks.onTick({now:f.now});await f.plugin.services.diaryWorker.whenIdle({key});assert.equal(f.requests.length,0,'the bell never queues a general memory refresh');assert.equal(f.sent.length,4);
 await createPlugin(f.ctx).hooks.onTick({now:f.now+1000});assert.equal(f.sent.length,4);
 assert.equal((await memory.diaryStatus({key,day})).scheduledDeliveryStatus,'sent');
 assert(diaryReceiptIds({key,day,notes:'凭据：'+f.sent.at(-1).meta.id}).includes(f.sent.at(-1).meta.id));
});

test('an uncertain scheduled delivery is not retried or displayed as sent',async t=>{
 const f=scheduledFixture(t);f.ctx.capabilities.sendDiaryDelivery=async(_key,_body,meta)=>{f.requests.push(meta.id);return {ok:false,receiptStatus:'uncertain'};};
 f.ctx.capabilities.deliveryStatus=id=>({ok:true,status:id.endsWith(':scheduled')?'uncertain':'absent'});
 const plugin=createPlugin(f.ctx);await plugin.hooks.onTick({now:f.now});assert.equal(f.requests.length,0);
 const status=await plugin.services.memory.diaryStatus({key,day});assert.equal(status.scheduledDeliveryStatus,'uncertain');assert.equal(status.scheduledSentAt,0);
});

test('late completion stays archived after midnight and waits for an explicit catch-up',async t=>{
 const f=scheduledFixture(t);f.plugin.services.memory.updateDiary({key,day,now:f.now-1000,text:'BEFORE_MIDNIGHT'});
 await createPlugin(f.ctx).hooks.onTick({now:Date.parse('2026-11-02T00:01:00+08:00')});
 assert.equal(f.sent.length,0);assert.match(f.plugin.services.memory.diaryArchiveRead({date:day}).text,/BEFORE_MIDNIGHT/);
});

test('a success-shaped sender response without central confirmation cannot mark a diary sent',async t=>{
 const f=fixture(t);f.ctx.capabilities.sendDiaryDelivery=async()=>({ok:true});
 f.plugin.services.memory.updateDiary({key,day,now:Date.parse(day+'T12:00:00+08:00'),text:'NOT_CONFIRMED'});
 const result=await f.plugin.services.memory.sendDiaryDetailed({key,day,manualRequestId:'manual-false-success'});
 assert.equal(result.reason,'delivery_unconfirmed');assert.equal(f.state.lastDiaryDate?.[key],undefined);
});

test('overlong drafts must be rewritten before either writing path can replace the diary', t=>{
 const f=scheduledFixture(t),memory=f.plugin.services.memory,now=f.now-60000;
 const original='今天最在意的一件事。',long='多余的流水账。'.repeat(100);
 assert.equal(memory.updateDiary({key,day,now,text:original}).ok,true);
 assert.equal(memory.updateDiary({key,day,now,text:long}).reason,'diary_too_long');
 assert.equal(memory.capture({key,now,text:'<MEMORY>【日记】\n'+long+'</MEMORY>'}).reason,'diary_too_long');
 assert.equal(memory.diaryText({key}),original);
 assert.match(memory.diaryArchiveRead({date:day}).text,new RegExp(original));
});

test('the committed transport receipt is sufficient even if a subsequent lookup is unavailable',async t=>{
 let committed=false;
 const f=fixture(t,{lookup:async()=>{if(committed)throw Error('receipt read unavailable');return {ok:true,status:'absent'};}});
 f.ctx.capabilities.sendDiaryDelivery=async()=>{committed=true;return {ok:true,receiptStatus:'sent',partsSent:1,partsTotal:1};};
 f.plugin.services.memory.updateDiary({key,day,now:Date.parse(day+'T12:00:00+08:00'),text:'ONE_CONFIRMED_MESSAGE'});
 const result=await f.plugin.services.memory.sendDiaryDetailed({key,day,manualRequestId:'committed-transport'});
 assert.equal(result.ok,true);
 assert.equal(f.state.lastDiaryDate[key],day);
});

test('starting after the boundary exposes a missed previous diary without automatically refreshing or sending it',async t=>{
 const f=scheduledFixture(t);f.ctx.capabilities.runtimeStartedAt=f.now+60000;
 f.plugin.services.memory.write({key,text:'【重要事实】\nKEEP_FACT\n【日记】\nEXISTING_PREVIOUS'});
 f.plugin.services.memory.updateDiary({key,day,now:f.now-60000,text:'EXISTING_PREVIOUS'});
 f.sent.length=0;const plugin=createPlugin(f.ctx);
 await plugin.hooks.onTick({now:f.now+120000});
 assert.equal(f.requests.length,0);assert.equal(f.sent.length,0);
 const status=await plugin.services.memory.diaryStatus({key,now:f.now+120000});
 assert.equal(status.day,'2026-11-02');assert.equal(status.previousDay,day);assert.equal(status.previousDiaryMissing,true);assert.equal(status.previousDiaryAvailable,true);
 assert.match(plugin.services.memory.read({key}).text,/KEEP_FACT/);assert.match(plugin.services.memory.read({key}).text,/EXISTING_PREVIOUS/,'keep the undelivered diary until catch-up is confirmed');
 const result=await plugin.services.memory.catchUpDiaries({key,now:f.now+120000,confirmLegacyUnsent:true});
 assert.equal(result.results[0].ok,true);assert.equal(f.requests.length,0);assert.equal(f.sent.length,1);assert.match(f.sent[0].body,/EXISTING_PREVIOUS/);
 assert.equal((await plugin.services.memory.diaryStatus({key,now:f.now+120000})).previousDiaryMissing,false);
 assert.doesNotMatch(plugin.services.memory.read({key}).text,/EXISTING_PREVIOUS/);
 await plugin.services.memory.catchUpDiaries({key,now:f.now+130000,confirmLegacyUnsent:true});assert.equal(f.sent.length,1);
});

test('an ended diary retires only after a confirmed physical send',async t=>{
 const f=scheduledFixture(t),memory=f.plugin.services.memory;
 memory.updateDiary({key,day,text:'BEFORE_SCHEDULE',now:f.now-1000});
 const send=f.ctx.capabilities.sendDiaryDelivery;
 f.ctx.capabilities.sendDiaryDelivery=async(...args)=>{assert.equal(memory.diaryText({key}),'BEFORE_SCHEDULE');return send(...args);};
 await f.plugin.hooks.onTick({now:f.now});await f.plugin.services.diaryWorker.whenIdle({key});assert.equal(f.sent.length,1);assert.equal(memory.diaryText({key}),'');
});

test('unconfirmed scheduled transport keeps the ended diary and cannot silently erase it',async t=>{
 const f=scheduledFixture(t),m=f.plugin.services.memory;m.updateDiary({key,day,text:'KEEP_UNCONFIRMED_BODY',now:f.now-1000});
 f.ctx.capabilities.sendDiaryDelivery=async()=>({ok:false,reason:'send_unconfirmed',receiptStatus:'uncertain'});
 await f.plugin.hooks.onTick({now:f.now});await f.plugin.services.diaryWorker.whenIdle({key});
 assert.equal(m.diaryText({key}),'KEEP_UNCONFIRMED_BODY');const audit=await m.diaryStatus({key,day});assert(audit.attempts.some(a=>a.receiptStatus==='uncertain'));
});

test('diary drafting distinguishes prior-day history from this window and does not inherit the chat count cap',()=>{
 const now=Date.parse('2026-11-01T18:30:00+08:00'),window=diaryWindow(day,{hour:18,minute:30}),st={recentMessages:[
 {seq:1,time:Date.parse('2026-10-30T12:00:00+08:00'),text:'OLD_DAY'},
 {seq:2,time:now-2000,text:'IN_WINDOW_1'},
 {seq:3,time:now-1000,text:'IN_WINDOW_2'},
 {seq:4,time:now,text:'NEXT_WINDOW'}]};
 assert.deepEqual(diaryEvidence(st,window,now).map(m=>m.text),['IN_WINDOW_1','IN_WINDOW_2']);
 const update=createUpdate({config:{},callService:()=>window}).hooks.beforePrompt({key,reason:'memoryWrite',now,st,memoryWindow:1});
 assert.match(update,/2026-10-31 18:30 至 2026-11-01 18:30/);assert.match(update,/IN_WINDOW_2/);assert.match(update,/IN_WINDOW_1/);assert.doesNotMatch(update,/OLD_DAY|NEXT_WINDOW|22:00/);assert.match(update,/允许结合历史聊天偶尔与昨天对比/);
 const blocks=[];createContext({config:{},capabilities:{},addPromptBlock:text=>blocks.push(text)}).hooks.beforePrompt({key,reason:'memoryWrite',st:{},persistentMemory:{text:'【重要事实】\nSTABLE_FACT\n【日记】\nOLD_DIARY'}});
 assert.match(blocks.join(''),/STABLE_FACT/);assert.doesNotMatch(blocks.join(''),/OLD_DIARY/);
});

test('AI may update only the current-window diary without modifying facts, sending QQ, or replaying an old-window write',t=>{
 const f=scheduledFixture(t),memory=f.plugin.services.memory,now=f.now-1000;
 memory.write({key,text:'【重要事实】\nKEEP_FACT\n【用户画像】\nKEEP_PORTRAIT'});
 assert.equal(memory.updateDiary({key,day,text:'TODAY_FIRST',now}).ok,true);
 assert.equal(memory.diaryDraftContext({key,now}).sameWindowDiary,'TODAY_FIRST');
 assert.equal(memory.updateDiary({key,day,text:'TODAY_UPDATED',now:now+100}).ok,true);
 assert.equal(memory.updateDiary({key,day,text:'【重要事实】\nINJECTED_FACT',now:now+200}).ok,false);
 assert.equal(memory.updateDiary({key,day,text:'STALE_WRITE',now:f.now+1}).ok,false);
 assert.match(memory.read({key}).text,/KEEP_FACT/);assert.match(memory.read({key}).text,/KEEP_PORTRAIT/);assert.equal(f.sent.length,0);
});

test('every AI diary update is written through to history before any scheduled send and survives reload',t=>{
 const f=scheduledFixture(t),memory=f.plugin.services.memory,now=f.now-10000;
 assert.equal(memory.updateDiary({key,day,text:'SAVED_WITHOUT_SENDING',now}).ok,true);
 assert.match(memory.diaryArchiveRead({date:day}).text,/SAVED_WITHOUT_SENDING/);
 const captured=memory.capture({key,text:'<MEMORY>【日记】\nLATEST_DRAFT_AFTER_SUMMARY</MEMORY>',now:now+1000});assert.equal(captured.archiveSaved,true);
 const reloaded=createPlugin(f.ctx),archive=reloaded.services.memory.diaryArchiveRead({date:day});assert.match(archive.text,/LATEST_DRAFT_AFTER_SUMMARY/);assert.doesNotMatch(archive.text,/SAVED_WITHOUT_SENDING|> 已发送：/);assert.equal(f.sent.length,0);
});
