import test from 'node:test';import assert from 'node:assert/strict';
import {createMilkMonitor} from '../monitor.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {mock} from 'node:test';
import {createPlugin as createNotes} from '../../tool-user-checking/index.js';
function fixture(){let state={},now=Date.now(),amount='10.00',requests=0;const ctx={config:{},state:{get:()=>state,set:p=>state={...state,...p}},capabilities:{getOwnerQQ:()=>123}};const m=createMilkMonitor(ctx,{clock:()=>now,query:async()=>{requests++;return {ok:true,is_available:amount!=='0',balance_infos:[{currency:'CNY',total_balance:amount,granted_balance:'0',topped_up_balance:amount}]};}});return {m,state:()=>state,next(n){amount=n;now+=300000;},requests:()=>requests};}
test('private/group share staged milk changes, while exact account data remains owner-only',async()=>{
 const f=fixture();await f.m.query();f.next('0.60');await f.m.query();
 for(const key of ['private:124','group:456']){const view=await f.m.queryFor({key});assert.equal(view.milk.stock.stage,'critical');assert(!JSON.stringify(view).includes('0.60'));assert(!JSON.stringify(view).includes('balance_infos'));assert.match(f.m.context({key}),/见底/);assert.match(f.m.context({key}),/user_checking/);assert.match(f.m.context({key}),/清晰|友好交流/);}
 assert.match(f.m.context({key:'private:123'}),/CNY 0.60/);assert.equal(f.m.context({key:'bad'}),'');
});
test('only successful relevant delivery consumes a change per session; replenishment opens a new change',async()=>{
 const f=fixture();await f.m.query();f.next('4.00');await f.m.query();const key='group:456';assert.match(f.m.context({key}),/这次可说/);
 f.m.sent({key,success:false,messages:['调用额度不够啦']});assert.match(f.m.context({key}),/这次可说/);
 f.m.sent({key,success:true,messages:['今天晴天']});assert.match(f.m.context({key}),/这次可说/);
 f.m.sent({key,success:true,messages:['调用额度不多了，想小口一点喝……']});assert.doesNotMatch(f.m.context({key}),/这次可说/);assert.match(f.m.context({key:'private:124'}),/这次可说/);
 f.next('20.00');await f.m.query();assert.match(f.m.context({key}),/这次可说/);assert.match(f.m.context({key}),/补充|恢复/);
});
test('note receipt is global and exact-event-specific; stale and failed reads do not advertise new stock',async()=>{
 const f=fixture();await f.m.query();f.next('0');await f.m.query();const view=await f.m.queryFor({key:'group:456'}),id=view.milk.change.id;
 assert.equal(f.m.noteStatus({eventId:id}).known,true);assert.equal(f.m.noteWritten({eventId:'invented'}).ok,false);f.m.noteWritten({eventId:id});assert.equal(f.m.noteStatus({eventId:id}).noted,true);assert.doesNotMatch(f.m.context({key:'private:124'}),/建议.*user_checking/);
 f.next('20.00');await f.m.query();assert.match(f.m.context({key:'group:456'}),/建议.*user_checking/);assert.equal(f.m.noteStatus({eventId:id}).known,false);
});
test('the actual desktop note writer appends a milk event once across sessions and preserves old file bytes',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'milk-note-'));fs.mkdirSync(path.join(home,'Desktop'));const file=path.join(home,'Desktop/fixture.txt');fs.writeFileSync(file,'原有便签\n');const stub=mock.method(os,'homedir',()=>home);
 try{const f=fixture();await f.m.query();f.next('0.60');await f.m.query();const eventId=(await f.m.queryFor({key:'group:456'})).milk.change.id;let tool;
  createNotes({config:{noteFileName:'fixture.txt'},log(){},registerTool:(_n,t)=>tool=t,callService:(s,m,p)=>s==='milkStock'?f.m[m](p):null});
  const body={action:'note',milkEventId:eventId,text:'调用额度快见底啦，我想小口一点喝……'};assert.equal(tool.handler(body).ok,true);assert.equal(tool.handler(body).alreadyRecorded,true);const text=fs.readFileSync(file,'utf8');assert(text.startsWith('原有便签\n'));assert.equal(text.split(body.text).length-1,1);
  f.next('20.00');await f.m.query();assert.equal(tool.handler(body).alreadyRecorded,true);assert.equal(tool.handler({...body,milkEventId:'made-up'}).ok,false);
 }finally{stub.mock.restore();fs.rmSync(home,{recursive:true,force:true});}
});
