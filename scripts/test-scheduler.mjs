import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
test('real incoming messages preempt casual openings, while reminder and chat turns remain protected',async()=>{
 const {createPlugin}=await import('../plugins/qq-components/life-scheduler/index.js');
 const policy=createPlugin({runtime:{},config:{}}).services.scheduler.wakePolicy;
 for(const activeReason of ['startupGreeting','timeBubble','proactiveCheck','idleRescue','careCheck','newsShare','privateFollowup'])for(const incomingReason of ['private','message','message:670','atMention','reply','poke'])assert.equal(policy({incomingReason,activeReason}).preempt,true,activeReason+' / '+incomingReason);
 for(const activeReason of ['reminder','message','private','memoryWrite','taskDone'])assert.equal(policy({incomingReason:'private',activeReason}).preempt,false,activeReason);
 assert.equal(policy({incomingReason:'proactiveCheck',activeReason:'timeBubble'}).preempt,true);
 assert.equal(policy({incomingReason:'proactiveCheck',activeReason:'startupGreeting'}).preempt,false);
});
test('central scheduler runs one due task, skips expired notifications, and cancels an owner',async()=>{
 const {createPlugin}=await import('../plugins/qq-components/life-scheduler/index.js');let state={},runs=0;const runtime={};
 const ctx={runtime,config:{},isActive:()=>true,isPluginEnabled:()=>true,state:{get:()=>state,set:p=>state={...state,...p}},warn(){}};
 const p=createPlugin(ctx),s=p.services.scheduler;s.schedule({id:'due',at:100,run:()=>runs++});s.schedule({id:'old',at:10,expiresAt:20,run:()=>runs+=100});s.schedule({id:'cancel',owner:'owner',at:100,run:()=>runs+=100});s.cancelOwner('owner');await p.hooks.onTick({now:100});await p.hooks.onTick({now:101});assert.equal(runs,1);
 s.schedule({id:'hot',at:200,run:()=>runs++});await createPlugin(ctx).hooks.onTick({now:200});assert.equal(runs,2);
});
test('delivery receipts survive reload and unknown send outcome never auto-replays',async()=>{
 const {createDeliveryLedger}=await import('../plugins/qq-components/life-scheduler/delivery-ledger.mjs');const root=fs.mkdtempSync(path.join(os.tmpdir(),'delivery-ledger-'));const file=path.join(root,'receipts.json');
 try{let l=createDeliveryLedger({file,now:()=>100});assert.equal(l.claim({id:'diary:day',expiresAt:200}).ok,true);l.finish('diary:day',true);l=createDeliveryLedger({file,now:()=>101});assert.equal(l.claim({id:'diary:day',expiresAt:200}).ok,false);assert.equal(l.claim({id:'old-campus',expiresAt:50}).ok,false);assert.equal(l.claim({id:'uncertain',expiresAt:200}).ok,true);l.finish('uncertain',false);assert.equal(l.claim({id:'uncertain',expiresAt:200}).ok,false);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
