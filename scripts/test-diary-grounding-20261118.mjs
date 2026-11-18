import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/ctx-memory-store/index.js';
import {createDiaryWorker} from '../plugins/qq-components/ctx-memory-store/diary-worker.mjs';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {createDiaryMaterials} from '../plugins/qq-components/ctx-memory-store/diary-materials.mjs';
import {describeQQDeliveryError} from '../src/outbound-context.js';
const key='group:40001',day='2026-11-18',at=clock=>Date.parse(day+'T'+clock+':00+08:00');
function workerFixture(){let state={},now=at('09:05'),messages=[],saved;const prompts=[];
 const ctx={state:{get:()=>state,set:p=>state={...state,...p}},capabilities:{now:()=>now,memoryWorkerContext:()=>({messages,role:'第一人称，简短自然'}),runReadOnlyWorker:async p=>{prompts.push(p.prompt);return {text:'一天的喧闹里，我记住的是大家终于松了口气，也跟着觉得踏实。'};}}};
 const worker=()=>createDiaryWorker(ctx,{context:()=>({ok:true,day,start:'2026-11-17 22:00',end:day+' 22:00',maxDiaryChars:350,revision:'r',text:'YESTERDAY_COFFEE_STALE'}),save:p=>{saved=p;return {ok:true};},afterSave:async()=>({ok:true,receiptStatus:'sent'})});
 return {ctx,worker,prompts,state:()=>state,set:(t,m)=>{now=t;messages=m;},saved:()=>saved,data:()=>JSON.parse(prompts.at(-1).split('会话资料JSON：')[1].split('\n\n资料结束')[0])};}
test('daytime evidence survives rolling chat and worker reload with source-local times',async()=>{
 const f=workerFixture();let w=f.worker();f.set(at('09:05'),[{messageId:'morning',at:at('09:00'),userId:'10001',text:'MORNING_PROGRAM_FIXED'}]);assert(w.request({key,day,now:at('09:05')}));await w.whenIdle({key});
 w=f.worker();f.set(at('22:00'),[{messageId:'afternoon',at:at('14:33'),userId:'10002',text:'AFTERNOON_STORY'},{messageId:'evening',at:at('21:30'),userId:'10001',text:'EVENING_RELIEF'}]);assert(w.request({key,day,now:at('22:00'),purpose:'scheduled'}));await w.whenIdle({key});
 const data=f.data();assert(data.evidence.some(e=>e.text==='MORNING_PROGRAM_FIXED'),'morning raw source must survive the rolling snapshot');const afternoon=data.evidence.find(e=>e.text==='AFTERNOON_STORY');assert.equal(afternoon.localTime,day+' 14:33:00');assert.equal(afternoon.period,'afternoon');assert.equal(data.evidence.filter(e=>e.text==='MORNING_PROGRAM_FIXED').length,1);
});
test('legacy narrative and the previous evening cannot re-enter the day as factual evidence',async()=>{
 const f=workerFixture();f.ctx.state.set({diaryDayDrafts:{[key]:{day,periods:{afternoon:{at:at('15:00'),text:'LEGACY_YESTERDAY_STALE'}}}}});f.set(at('22:00'),[{at:Date.parse('2026-11-17T23:30:00+08:00'),text:'YESTERDAY_RAW',userId:'10001'},{at:at('14:33'),text:'TODAY_ONLY',userId:'10001'},{at:at('22:01'),text:'AFTER_BELL',userId:'10001'}]);const w=f.worker();w.request({key,day,now:at('22:00'),purpose:'scheduled'});await w.whenIdle({key});const data=f.data();assert(!JSON.stringify(data).includes('STALE'));assert.deepEqual(data.evidence.map(e=>e.text),['TODAY_ONLY']);assert.match(f.prompts[0],/北京时间/);assert.match(f.prompts[0],/主题/);
});
test('incoming source evidence persists before the next random draft and remains session scoped',async()=>{
 let state={};const ctx={root:process.cwd(),config:{},state:{get:()=>state,set:p=>state={...state,...p}},capabilities:{now:()=>at('14:35')},callService:()=>null};let plugin=createPlugin(ctx);plugin.hooks.onIncoming({key,at:at('14:33'),messageId:'source-one',userId:'10001',text:'KEEP_BEFORE_DRAFT'});plugin=createPlugin(ctx);assert.equal(plugin.services.diaryMaterials.read({key,day,now:at('22:00')}).evidence[0].text,'KEEP_BEFORE_DRAFT');assert.equal(plugin.services.diaryMaterials.read({key:'private:10001',day,now:at('22:00')}).evidence.length,0);
});
test('a day with only bot output does not inherit yesterday human activity',async()=>{
 const f=workerFixture();f.set(at('22:00'),[{at:at('09:00'),isSelf:true,text:'BOT_ONLY'},{at:at('09:00')-86400000,userId:'10001',text:'OLD_HUMAN'}]);const w=f.worker();assert.equal(w.request({key,day,now:at('22:00'),purpose:'scheduled'}),false);assert.equal(f.prompts.length,0);
});
test('the same source from incoming and worker snapshot is deduplicated despite a missing messageId',()=>{
 let state={};const ctx={state:{get:()=>state,set:p=>state={...state,...p}}},m=createDiaryMaterials(ctx),msg={at:at('14:33'),userId:'10001',text:'同一条来信'};m.capture({key,day,now:at('14:35'),messages:[{...msg,messageId:'qq-id'}]});m.capture({key,day,now:at('14:35'),messages:[{...msg,seq:27}]});assert.equal(m.read({key,day,now:at('22:00')}).evidence.length,1);
});
test('sampling preserves morning and afternoon sources when late chat is dense; late events stay beyond the bell',()=>{
 let state={};const ctx={state:{get:()=>state,set:p=>state={...state,...p}}},m=createDiaryMaterials(ctx);const messages=[{at:at('09:00'),userId:'10001',text:'早间'}, {at:at('14:33'),userId:'10001',text:'午后'},...Array.from({length:300},(_,i)=>({at:at('20:00')+i*1000,userId:'10001',text:'晚间'+i})),{at:at('22:01'),userId:'10001',text:'到点之后'}];m.capture({key,day,now:at('22:10'),messages});const r=m.read({key,day,now:at('22:10'),end:day+' 22:00'});assert(r.evidence.some(x=>x.text==='早间'));assert(r.evidence.some(x=>x.text==='午后'));assert(!r.evidence.some(x=>x.text==='到点之后'));assert(r.evidence.length<=144);assert(state.diaryMaterials[key].periods.evening.length<=240);
});
test('delivery diagnostics retain protocol codes but exclude echoed content and arbitrary secrets',()=>{
 assert.match(describeQQDeliveryError(Error('code=1006507 网络连接异常! PRIVATE_BODY secret=DO_NOT_KEEP')),/1006507/);assert.doesNotMatch(describeQQDeliveryError(Error('PRIVATE_BODY secret=DO_NOT_KEEP')),/PRIVATE_BODY|DO_NOT_KEEP/);assert.match(describeQQDeliveryError(Error('socket timeout')),/异常|超时/);
});
test('diary transport preserves the sanitized QQ error through status without retry or false success',async()=>{
 const h=await bridgeHarness();try{h.setMode('reserved2');const k='private:123',now=Date.now(),date=h.pluginHost.callService('memory','diaryCurrent',{key:k,now}).day;h.pluginHost.callService('memory','updateDiary',{key:k,day:date,now,text:'这是一份日记。'});let attempts=0;h.bot.sendPrivateMessage=async()=>{attempts++;throw Error('MessageSvc.PbSendMsg code=1006507 网络连接异常! fixture-console-token');};const result=await h.pluginHost.callService('memory','sendDiaryDetailed',{key:k,day:date,now,allowArchiveRetry:true});assert.equal(result.receiptStatus,'uncertain');assert.match(result.error,/1006507/);assert(!result.error.includes('fixture-console-token'));const status=await h.pluginHost.callService('memory','diaryStatus',{key:k,day:date,now});assert.match(status.attempts[0].error,/1006507/);assert.equal(status.sentForDay,false);assert.equal((await h.pluginHost.callService('memory','sendDiaryDetailed',{key:k,day:date,now,allowArchiveRetry:true})).reason,'delivery_unconfirmed');assert.equal(attempts,1);}finally{await h.close();}
});
