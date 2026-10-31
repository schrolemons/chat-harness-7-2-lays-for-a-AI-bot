import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPlugin} from '../plugins/qq-components/ctx-memory-store/index.js';

for(const stage of ['weak','silent'])test(stage+': scheduled diary sends existing dated content without asking a model to refresh it',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'budget-diary-')),now=Date.now(),key='private:1';
 let state={lastWriteAt:{[key]:now}},requests=0;const sent=[];
 try{
  const plugin=createPlugin({root,config:{},log:()=>{},state:{get:()=>state,set:p=>state={...state,...p}},capabilities:{
   memoryConfig:()=>({enabled:true,updateIntervalMin:60,dailyDiary:{enabled:true,hour:0,minute:0,maxChars:500}}),
   listConversationKeys:()=>[key],budgetRecoveryStatus:()=>({stage}),requestMemoryWrite:()=>{requests++;return true;},
   sendNotification:(_key,body)=>{sent.push(body);return true;}
  },registerTool:()=>{}});
  plugin.services.memory.write({key,text:'【日记】\n今天已有的日记正文。'});
  await plugin.hooks.onTick({now});assert.equal(requests,0);assert.equal(sent.length,1);assert.match(sent[0],/今天已有的日记正文/);
  await plugin.hooks.onTick({now:now+1000});assert.equal(sent.length,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
