import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createPlugin as memory} from '../plugins/qq-components/ctx-memory-store/index.js';
import {createPlugin as campus} from '../plugins/qq-components/life-campus-watch/index.js';
import {createPlugin as facts} from '../plugins/qq-components/ctx-memory-profile-facts/index.js';
import {createPlugin as evaluation} from '../plugins/qq-components/eval-regression/index.js';
import {createPlugin as monitor} from '../plugins/qq-components/obs-health-monitor/index.js';
import {createDeliveryLedger} from '../plugins/qq-components/life-scheduler/delivery-ledger.mjs';

function diaryFixture(t,{delivered=false,startedAfterBoundary=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'diary-contract-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const key='private:1',day='2026-11-02',now=Date.parse(day+'T00:01:00+08:00');
 let clock=now,accept=false,state={lastWriteAt:{[key]:now}};
 const requests=[],sent=[],ledger=createDeliveryLedger({file:path.join(root,'receipts.json'),now:()=>clock});
 const capabilities={runtimeStartedAt:startedAfterBoundary?now:now-3600000,
  memoryConfig:()=>({enabled:true,updateIntervalMin:60,dailyDiary:{enabled:true,hour:0,minute:0}}),
  listConversationKeys:()=>[key],requestMemoryWrite:(key,opts)=>{requests.push({key,opts});return accept;},
  deliveryStatus:id=>ledger.status(id),async sendNotificationDetailed(key,body,meta){
   const claim=ledger.claim(meta);if(!claim.ok)return {ok:false,reason:claim.reason};
   sent.push({key,body,meta});ledger.finish(meta.id,delivered);
   return {ok:delivered,reason:delivered?undefined:'send_unconfirmed',receiptStatus:delivered?'sent':'uncertain'};
  }};
 const ctx={root,config:{},state:{get:()=>state,set:patch=>state={...state,...patch}},log(){},warn(){},capabilities};
 const p=memory(ctx);
 p.services.memory.write({key,text:'【日记】\nOLD_DIARY'});
 return {root,key,day,now,p,requests,sent,ledger,get state(){return state;},accept(){accept=true;},recreate:()=>memory(ctx),
  async tick(at){clock=at;await p.hooks.onTick({now:at});},
  capture(at){return p.services.memory.capture({key,now:at,text:'<MEMORY>【日记】\nFRESH_DIARY</MEMORY>'});}};
}

test('midnight diary retries a refused refresh, waits for capture, and preserves an uncertain delivery',async t=>{
 const f=diaryFixture(t);await f.tick(f.now);
 assert.equal(f.state.lastDiaryDate?.[f.key],undefined);assert.equal(f.state.forceWriteAt?.[f.key]||0,0);
 assert.equal(f.state.retryAt[f.key],f.now+300000);assert.equal(f.sent.length,0);
 f.accept();await f.tick(f.now+360000);
 assert.equal(f.state.forceWriteAt[f.key],f.now+360000);assert.equal(f.requests.length,2);
 assert.ok(f.requests.every(r=>r.key===f.key&&r.opts?.force===true));
 const file=path.join(f.root,'state/memory/private_1.md');
 fs.utimesSync(file,new Date(f.now+400000),new Date(f.now+400000));
 await f.tick(f.now+420000);assert.equal(f.sent.length,0,'file mtime alone cannot complete a model refresh');
 assert.equal(f.capture(f.now+420000).matched,true);
 await f.tick(f.now+421000);assert.equal(f.sent.length,1);assert.match(f.sent[0].body,/FRESH_DIARY/);
 assert.equal(f.ledger.status('diary:'+f.key+':'+f.day+':scheduled').status,'uncertain');
 assert.equal(f.state.lastDiaryDate?.[f.key],undefined);assert.match(f.p.services.memory.diaryText({key:f.key}),/FRESH_DIARY/);
 await f.tick(f.now+480000);assert.equal(f.sent.length,1,'an uncertain result must not auto-replay');
});

test('confirmed central receipt completes the midnight diary once and survives component recreation',async t=>{
 const f=diaryFixture(t,{delivered:true});f.accept();await f.tick(f.now);
 assert.equal(f.sent.length,0);f.capture(f.now+1000);await f.tick(f.now+2000);
 assert.equal(f.sent.length,1);assert.equal(f.state.lastDiaryDate[f.key],f.day);
 assert.equal(f.ledger.status('diary:'+f.key+':'+f.day+':scheduled').status,'sent');
 assert.match(f.p.services.memory.diaryArchiveRead({date:f.day}).text,/FRESH_DIARY/);
 await f.tick(f.now+3000);assert.equal(f.sent.length,1);
 await f.recreate().hooks.onTick({now:f.now+4000});assert.equal(f.sent.length,1,'recreation must honor the persisted sent receipt');
});

test('starting after the midnight boundary does not manufacture a scheduled catch-up refresh',async t=>{
 const f=diaryFixture(t,{startedAfterBoundary:true});f.accept();await f.tick(f.now);
 assert.equal(f.requests.length,0);assert.equal(f.sent.length,0);assert.equal(f.state.forceWriteAt?.[f.key],undefined);
});
test('campus configured fast interval works and reload preserves full-check cooldown',()=>{let state={},runs=[];const ctx={root:fs.mkdtempSync(path.join(os.tmpdir(),"campus-contract-")),registerTool(){},config:{fastCheckMinutes:5,fullCheckMinutes:30,enabledScripts:['lectures'],lecturesEnabled:true},state:{get:()=>state,set:p=>state={...state,...p}},capabilities:{spawnCampusWatch:a=>{runs.push(a);return true}}};const p=campus(ctx),now=1800000000000;p.hooks.onTick({now});p.hooks.onTick({now:now+60000});assert.equal(runs.length,1);campus(ctx).hooks.onTick({now:now+120000});assert.equal(runs.length,1);p.hooks.onTick({now:now+300000});assert.equal(runs.length,2);assert.deepEqual(runs[1],['--lectures-only']);});
test('profile facts use admitted evidence, isolate session cooldowns and preserve candidates during maintenance',()=>{
 let state={};const blocks=[];
 const p=facts({config:{cooldownMs:600000},state:{get:()=>state,set:patch=>state={...state,...patch}},
  addPromptBlock:text=>blocks.push(text)});
 const first={key:'private:1',userId:'1',sender:'甲',text:'我喜欢蓝色',messageId:'fixture-1',seq:1};
 const second={key:'private:2',userId:'2',sender:'乙',text:'我喜欢绿色',messageId:'fixture-2',seq:2};
 p.hooks.onIncoming(first);p.hooks.onIncoming(second);
 const maintenance=p.hooks.beforePrompt({key:first.key,reason:'memoryWrite',st:{recentMessages:[first]}});
 assert.match(maintenance,/我喜欢蓝色/);assert.doesNotMatch(maintenance,/我喜欢绿色/);
 assert.equal(state.pending.length,2);assert.equal(state.lastAskedByKey?.[first.key],undefined);
 assert.equal(p.hooks.beforePrompt({key:first.key,reason:'message'}),'','early candidates are not admitted chat messages');
 const chat=p.hooks.beforePrompt({key:first.key,reason:'message',admittedMessages:[first]});
 assert.match(chat,/我喜欢蓝色/);assert.doesNotMatch(chat,/我喜欢绿色/);assert.ok(blocks.some(text=>text.includes('profile_update')));
 assert.equal(p.hooks.beforePrompt({key:first.key,reason:'message',admittedMessages:[first]}),'');
 assert.match(p.hooks.beforePrompt({key:second.key,reason:'message',admittedMessages:[second]}),/我喜欢绿色/);
 assert.match(p.hooks.beforePrompt({key:first.key,reason:'memoryWrite',st:{recentMessages:[first]}}),/我喜欢蓝色/);
 assert.equal(state.pending.length,2,'rendering and maintenance do not prove a successful profile write');
});
test('regression case identifiers stay unique after bounded history fills',()=>{let state={},tools=new Map();evaluation({config:{maxCases:5},state:{get:()=>state,set:p=>state={...state,...p}},registerTool:(n,s)=>tools.set(n,s)});for(let i=0;i<9;i++)tools.get('eval_record_case').handler({title:'case-'+i});assert.equal(new Set(state.cases.map(c=>c.id)).size,5);});
test('health monitor records cooldown only after confirmed successful notification',async()=>{let state={},ok=false;const p=monitor({config:{},state:{get:()=>state,set:x=>state={...state,...x}},capabilities:{collectHealth:async()=>({fixture:{stale:true}}),notifyOwner:async()=>ok}});await p.hooks.onTick();assert.equal(state.lastAlertAt,undefined);ok=true;await p.hooks.onTick();assert.ok(state.lastAlertAt);});
