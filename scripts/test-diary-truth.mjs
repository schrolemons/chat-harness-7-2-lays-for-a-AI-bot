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
 const sent=[],requests=[],now=Date.parse('2026-11-01T18:30:00+08:00'),state={lastWriteAt:{[key]:now}};
 const capabilities=withDiaryDelivery(root,{runtimeStartedAt:now-3600000,memoryConfig:()=>({enabled:true,dailyDiary:{enabled:true,hour:18,minute:30}}),listConversationKeys:()=>[key],requestMemoryWrite:(key,opts)=>{requests.push({key,opts});return true;},sendNotification:(key,body,meta)=>{sent.push({key,body,meta});return true;}});
 const ctx={root,config:{},state:{get:()=>state,set:patch=>Object.assign(state,patch)},log:()=>{},warn:()=>{},registerTool:()=>{},capabilities};
 return {root,state,sent,requests,now,ctx,plugin:createPlugin(ctx)};
}

test('any number of manual sends leaves the scheduled refresh and delivery intact across reload',async t=>{
 const f=scheduledFixture(t),memory=f.plugin.services.memory;
 for(let i=0;i<3;i++){memory.write({key,text:'【日记】\nMANUAL_'+i});assert.equal((await memory.sendDiaryDetailed({key,day,now:f.now-60000,manualRequestId:'manual-click-'+i})).ok,true);}
 assert.equal((await memory.diaryStatus({key,day})).scheduledDeliveryStatus,'absent');
 await f.plugin.hooks.onTick({now:f.now});assert.equal(f.requests.length,1,'manual receipts and archives must not suppress the bell');assert.equal(f.sent.length,3,'wait for refreshed content');
 await f.plugin.hooks.onTick({now:f.now+1000});assert.equal(f.requests.length,1,'do not queue duplicate refreshes');
 memory.capture({key,text:'<MEMORY>【日记】\nSCHEDULED_FRESH</MEMORY>'});
 // A later manual refresh may update the next open window before the scheduler runs.
 memory.write({key,text:'【日记】\nNEXT_WINDOW_MANUAL'});
 assert.equal((await memory.sendDiaryDetailed({key,day:'2026-11-02',now:f.now+2000,manualRequestId:'manual-after-boundary'})).ok,true);
 const reloaded=createPlugin(f.ctx);await reloaded.hooks.onTick({now:f.now+3000});
 assert.equal(f.sent.length,5);assert.match(f.sent.at(-1).body,/SCHEDULED_FRESH/);assert.equal(f.sent.at(-1).meta.id,'diary:'+key+':'+day+':scheduled');
 const status=await reloaded.services.memory.diaryStatus({key,day});assert.equal(status.scheduledDeliveryStatus,'sent');assert(status.scheduledSentAt>0);
 await createPlugin(f.ctx).hooks.onTick({now:f.now+4000});assert.equal(f.sent.length,5,'restart must not ring the same bell twice');assert.equal(f.requests.length,1);
 assert(diaryReceiptIds({key,day,notes:'凭据：'+f.sent.at(-1).meta.id}).includes(f.sent.at(-1).meta.id));
});

test('an uncertain scheduled delivery is not retried or displayed as sent',async t=>{
 const f=scheduledFixture(t);f.ctx.capabilities.sendNotificationDetailed=async(_key,_body,meta)=>{f.requests.push(meta.id);return {ok:false,receiptStatus:'uncertain'};};
 f.ctx.capabilities.deliveryStatus=id=>({ok:true,status:id.endsWith(':scheduled')?'uncertain':'absent'});
 const plugin=createPlugin(f.ctx);await plugin.hooks.onTick({now:f.now});assert.equal(f.requests.length,0);
 const status=await plugin.services.memory.diaryStatus({key,day});assert.equal(status.scheduledDeliveryStatus,'uncertain');assert.equal(status.scheduledSentAt,0);
});

test('scheduled capture survives midnight before the next configured boundary',async t=>{
 const f=scheduledFixture(t);await f.plugin.hooks.onTick({now:f.now});
 f.plugin.services.memory.capture({key,text:'<MEMORY>【日记】\nBEFORE_MIDNIGHT</MEMORY>'});
 await createPlugin(f.ctx).hooks.onTick({now:Date.parse('2026-11-02T00:01:00+08:00')});
 assert.equal(f.sent.length,1);assert.match(f.sent[0].body,/2026-11-01 日日记/);
});

test('a success-shaped sender response without central confirmation cannot mark a diary sent',async t=>{
 const f=fixture(t);f.ctx.capabilities.sendNotificationDetailed=async()=>({ok:true});
 f.plugin.services.memory.write({key,text:'【日记】\nNOT_CONFIRMED'});
 const result=await f.plugin.services.memory.sendDiaryDetailed({key,day,manualRequestId:'manual-false-success'});
 assert.equal(result.reason,'delivery_unconfirmed');assert.equal(f.state.lastDiaryDate?.[key],undefined);
});

test('starting after the boundary exposes a missed previous diary without automatically refreshing or sending it',async t=>{
 const f=scheduledFixture(t);f.ctx.capabilities.runtimeStartedAt=f.now+60000;
 f.plugin.services.memory.write({key,text:'【重要事实】\nKEEP_FACT\n【日记】\nEXISTING_PREVIOUS'});
 await f.plugin.services.memory.sendDiaryDetailed({key,day,now:f.now-60000,manualRequestId:'manual-early-morning'});
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

test('scheduled diary remains in permanent memory through transport and retires only after a confirmed send',async t=>{
 const f=scheduledFixture(t),memory=f.plugin.services.memory;
 memory.updateDiary({key,day,text:'BEFORE_SCHEDULE',now:f.now-1000});
 await f.plugin.hooks.onTick({now:f.now});assert.equal(memory.diaryText({key}),'BEFORE_SCHEDULE');
 memory.capture({key,text:'<MEMORY>【日记】\nFRESH_BEFORE_RECEIPT</MEMORY>',now:f.now});
 const send=f.ctx.capabilities.sendNotificationDetailed;
 f.ctx.capabilities.sendNotificationDetailed=async(...args)=>{assert.equal(memory.diaryText({key}),'FRESH_BEFORE_RECEIPT');return send(...args);};
 await f.plugin.hooks.onTick({now:f.now+1000});assert.equal(f.sent.length,1);assert.equal(memory.diaryText({key}),'');
});

test('unconfirmed scheduled transport keeps the ended diary and cannot silently erase it',async t=>{
 const f=scheduledFixture(t);await f.plugin.hooks.onTick({now:f.now});
 f.plugin.services.memory.capture({key,text:'<MEMORY>【日记】\nKEEP_UNCONFIRMED_BODY</MEMORY>',now:f.now});
 f.ctx.capabilities.sendNotificationDetailed=async()=>({ok:false,reason:'send_unconfirmed',receiptStatus:'uncertain'});
 await f.plugin.hooks.onTick({now:f.now+1000});assert.equal(f.plugin.services.memory.diaryText({key}),'KEEP_UNCONFIRMED_BODY');
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
