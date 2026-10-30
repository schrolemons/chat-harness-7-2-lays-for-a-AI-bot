import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createImageEngine} from '../plugins/qq-components/exec-image-generation/engine.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
const config={apiBase:'https://images.example.test/v1',model:'example-image',size:'1024x1024',quality:'standard',quotaMode:'both',dailyGlobalLimit:2,dailySessionLimit:1,maxPromptChars:30,maxReferenceImages:1,maxReferenceBytes:100000,maxOutputBytes:100000,timeoutSeconds:2,cooldownSeconds:0,allowAutomatic:true,allowedSessions:[],assetRetentionDays:7};
const sleep=async fn=>{for(let i=0;i<40;i++){const out=fn();if(out.status!=='pending')return out;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('job remained pending');};
test('meme image request is idempotent, scoped to its chat, quota limited and uses generation API',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'meme-engine-'));let calls=0,clock=Date.parse('2026-10-27T15:59:00Z');
 try{const engine=createImageEngine({root,config,now:()=>clock,fetchImpl:async(url,opt)=>{calls++;assert.match(url,/images\/generations$/);assert.equal(JSON.parse(opt.body).prompt,'海边梗图');return new Response(JSON.stringify({data:[{b64_json:png.toString('base64')}]}),{headers:{'content-type':'application/json'}});}});engine.secret({op:'set',apiKey:'test-only-key'});
 const first=await engine.create({key:'group:10001',requestId:'request-1',prompt:'海边梗图'});assert.equal(first.ok,true);
 const done=await sleep(()=>engine.get({key:'group:10001',jobId:first.jobId}));assert.equal(done.status,'ready');assert.equal(calls,1);assert.ok(done.imageId);assert.equal(engine.asset({key:'group:10002',imageId:done.imageId}).ok,false);
 assert.equal(engine.claimSend({key:'group:10002',imageId:done.imageId}).ok,false);assert.equal(engine.claimSend({key:'group:10001',imageId:done.imageId}).ok,true);assert.equal(engine.claimSend({key:'group:10001',imageId:done.imageId}).error,'IMAGE_DELIVERY_ALREADY_ATTEMPTED');assert.equal(engine.finishSend({key:'group:10001',imageId:done.imageId,success:true}).status,'sent');
 assert.equal((await engine.create({key:'group:10001',requestId:'request-1',prompt:'海边梗图'})).jobId,first.jobId);assert.equal(calls,1);
 assert.equal((await engine.create({key:'group:10001',requestId:'request-1',prompt:'别的'})).ok,false);
 assert.equal((await engine.create({key:'group:10001',requestId:'request-2',prompt:'再来'})).error,'SESSION_DAILY_LIMIT');
 assert.equal((await engine.create({key:'group:10002',requestId:'request-3',prompt:'再来'})).ok,true);
 assert.equal((await engine.create({key:'group:10003',requestId:'request-4',prompt:'再来'})).error,'GLOBAL_DAILY_LIMIT');
 clock+=120000;assert.equal((await engine.create({key:'group:10001',requestId:'request-5',prompt:'明天'})).ok,true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('edits transmit the actual reference bytes and failed uncertain calls still consume a reservation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'meme-edit-'));let calls=0;
 try{const engine=createImageEngine({root,config:{...config,dailySessionLimit:1},fetchImpl:async(url,opt)=>{calls++;assert.match(url,/images\/edits$/);assert.equal(opt.body.get('prompt'),'改成梗图');const file=opt.body.get('image');assert.deepEqual(Buffer.from(await file.arrayBuffer()),png);return new Response('bad',{status:500});},readReferences:async()=>[{data:png.toString('base64'),mimeType:'image/png'}]});engine.secret({op:'set',apiKey:'test-only-key'});
 const first=await engine.create({key:'private:10001',requestId:'edit-1',prompt:'改成梗图',referenceMessageId:'-123'});assert.equal(first.ok,true);assert.equal((await sleep(()=>engine.get({key:'private:10001',jobId:first.jobId}))).status,'failed');assert.equal(calls,1);
 assert.equal((await engine.create({key:'private:10001',requestId:'edit-2',prompt:'再试'})).error,'SESSION_DAILY_LIMIT');
 const reloaded=createImageEngine({root,config,fetchImpl:async()=>{throw Error('must not retry');}});assert.equal((await reloaded.create({key:'private:10001',requestId:'edit-1',prompt:'改成梗图',referenceMessageId:'-123'})).jobId,first.jobId);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('provider image URL cannot target local services and oversized chunked JSON is rejected',async()=>{
 for(const [reply,expected] of [[{data:[{url:'https://127.0.0.1/internal.png'}]},'PROVIDER_REQUEST_FAILED'],[{large:'x'.repeat(100000)},'IMAGE_RESPONSE_TOO_LARGE']]){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'meme-untrusted-'));
  try{const engine=createImageEngine({root,config:{...config,maxOutputBytes:100},fetchImpl:async()=>new Response(JSON.stringify(reply),{headers:{'content-type':'application/json'}})});engine.secret({op:'set',apiKey:'test-key'});
   const submitted=await engine.create({key:'group:10001',requestId:'untrusted-1',prompt:'图片'});const result=await sleep(()=>engine.get({key:'group:10001',jobId:submitted.jobId}));assert.equal(result.status,'failed');assert.equal(result.error,expected);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
});

test('provider 429 preserves safe error code for quota diagnosis',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'meme-provider-429-'));
 try{const engine=createImageEngine({root,config,fetchImpl:async()=>new Response(JSON.stringify({error:{code:'credit_balance_exhausted',message:'private detail'}}),{status:429,headers:{'content-type':'application/json'}})});engine.secret({op:'set',apiKey:'test-key'});
  const submitted=await engine.create({key:'private:10001',requestId:'quota-429',prompt:'图片'});
  const result=await sleep(()=>engine.get({key:'private:10001',jobId:submitted.jobId}));
  assert.equal(result.error,'PROVIDER_HTTP_429_credit_balance_exhausted');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('retired provider settings and Ark credentials cannot activate an OpenAI request',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'meme-openai-only-'));
 try{
  fs.mkdirSync(path.join(root,'state/image-generation'),{recursive:true});
  fs.writeFileSync(path.join(root,'state/image-generation/secret.json'),JSON.stringify({arkApiKey:'retired-provider-key'}));
  const engine=createImageEngine({root,config:{...config,provider:'ark',arkApiBase:'https://ark.cn-beijing.volces.com/api/v3',arkModel:'retired-model'},fetchImpl:async()=>{throw Error('must not call any provider');}});
  assert.equal(engine.secret({op:'status'}).configured,false);
  assert.equal((await engine.create({key:'private:10001',requestId:'no-openai-key',prompt:'图片'})).error,'API_NOT_CONFIGURED');
  engine.secret({op:'set',apiKey:'openai-only-test-key'});
  assert.deepEqual(engine.secret({op:'status'}),{ok:true,provider:'openai',configured:true});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('image configuration declares only one set of OpenAI connection fields',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../plugins/qq-components/exec-image-generation/plugin.json',import.meta.url),'utf8'));
 assert.equal(Object.keys(manifest.config).some(k=>k==='provider'||k.startsWith('ark')),false);
 assert.equal(Object.keys(manifest.configSchema).some(k=>k==='provider'||k.startsWith('ark')),false);
});
