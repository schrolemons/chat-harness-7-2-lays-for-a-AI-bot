import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPlugin as createMemoryPlugin} from '../plugins/qq-components/ctx-memory-store/index.js';
import {withDiaryDelivery} from './fixtures/diary-delivery.mjs';
const createPlugin=ctx=>createMemoryPlugin({...ctx,capabilities:withDiaryDelivery(ctx.root,ctx.capabilities,{now:()=>Date.parse('2026-11-17T22:00:00+08:00')})});

for(const stage of ['weak','silent'])test(stage+': scheduled diary never claims an old draft was freshly generated when the model budget is unavailable',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'budget-diary-')),now=Date.parse('2026-11-17T22:00:00+08:00'),key='private:1';
 let state={lastWriteAt:{[key]:now},lastIncomingAt:{[key]:now-60000}},requests=0;const sent=[];
 try{
  const plugin=createPlugin({root,config:{},log:()=>{},state:{get:()=>state,set:p=>state={...state,...p}},capabilities:{
   runtimeStartedAt:now-3600000,memoryConfig:()=>({enabled:true,updateIntervalMin:60,dailyDiary:{enabled:true,hour:22,minute:0,maxChars:500}}),
   listConversationKeys:()=>[key],budgetRecoveryStatus:()=>({stage}),requestMemoryWrite:()=>{requests++;return true;},
   sendNotification:(_key,body)=>{sent.push(body);return true;}
  },registerTool:()=>{}});
  plugin.services.memory.updateDiary({key,day:'2026-11-17',now:now-1000,text:'今天已有的日记正文。'});
  await plugin.hooks.onTick({now});assert.equal(requests,0);assert.equal(sent.length,0);assert.match(plugin.services.memory.diaryArchiveRead({date:'2026-11-17'}).text,/今天已有的日记正文/);
  await plugin.hooks.onTick({now:now+1000});assert.equal(sent.length,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
