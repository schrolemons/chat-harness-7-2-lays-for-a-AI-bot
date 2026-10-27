import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {EnvHttpProxyAgent} from 'undici';
import {safeFetchBuffer} from '../../../src/safe-fetch.js';

const validKey=/^(?:private|group):[1-9]\d*$/;
const validRequest=/^[A-Za-z0-9_-]{3,96}$/;
const imageType=buffer=>buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':buffer.subarray(0,3).equals(Buffer.from([255,216,255]))?'image/jpeg':buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP'?'image/webp':null;
const dayAt=millis=>new Date(millis+8*3600000).toISOString().slice(0,10);
const bounded=(value,fallback,max)=>Math.min(max,Math.max(0,Number.isFinite(Number(value))?Number(value):fallback));
const readJson=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}};
const writeJson=(file,value)=>{const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600});fs.renameSync(tmp,file);};
function cleanJob(job){if(!job)return {ok:false,error:'JOB_NOT_FOUND'};return {ok:true,jobId:job.id,status:job.status,imageId:job.status==='ready'?job.id:undefined,error:job.error||undefined,createdAt:job.createdAt};}
export function createImageEngine({root,config={},fetchImpl=fetch,readReferences=async()=>[],now=Date.now,signal}={}){
 const provider=config.provider==='ark'?'ark':'openai';
 const model=provider==='ark'?config.arkModel:config.model;
 const size=provider==='ark'?(config.arkSize||'2K'):(config.size||'1024x1024');
 const baseUrl=provider==='ark'?config.arkApiBase:config.apiBase;
 let providerDispatcher;
 const dispatcher=()=>{
  if(providerDispatcher)return providerDispatcher;
  const proxy=String(config.proxyUrl||'').trim();
  if(proxy){let url;try{url=new URL(proxy);}catch{throw Error('PROXY_URL_INVALID');}
   if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('PROXY_URL_INVALID');}
  providerDispatcher=new EnvHttpProxyAgent(proxy?{httpProxy:proxy,httpsProxy:proxy}:{});
  return providerDispatcher;
 };
 signal?.addEventListener('abort',()=>void providerDispatcher?.close(),{once:true});
 const dir=path.join(root,'state','image-generation'),file=path.join(dir,'jobs.json'),secretFile=path.join(dir,'secret.json'),assets=path.join(dir,'assets');
 fs.mkdirSync(assets,{recursive:true,mode:0o700});
 const state=readJson(file,{jobs:[]});state.jobs=Array.isArray(state.jobs)?state.jobs:[];
 const retentionMs=bounded(config.assetRetentionDays,7,365)*86400000;
 function prune(){const kept=[];for(const job of state.jobs){if(Number(job.createdAt)>0&&now()-job.createdAt>retentionMs){if(/^[0-9a-f-]{36}$/i.test(String(job.id)))for(const ext of ['png','jpg','webp']){try{fs.unlinkSync(path.join(assets,job.id+'.'+ext));}catch{}}}else kept.push(job);}state.jobs=kept;}
 prune();
 for(const job of state.jobs)if(job.status==='pending')job.status='interrupted';
 writeJson(file,state);
 const save=()=>writeJson(file,state);
 const limit=()=>({global:bounded(config.dailyGlobalLimit,20,10000),session:bounded(config.dailySessionLimit,5,10000),mode:['global','session','both'].includes(config.quotaMode)?config.quotaMode:'both'});
 const apiUrl=endpoint=>{const base=new URL(String(baseUrl||''));if(!['https:','http:'].includes(base.protocol)||base.username||base.password)throw Error('API_BASE_INVALID');if(provider==='ark'&&(base.protocol!=='https:'||base.hostname!=='ark.cn-beijing.volces.com'))throw Error('API_BASE_INVALID');return new URL(base.href.replace(/\/+$/,'')+'/'+endpoint).href;};
 const secretField=provider==='ark'?'arkApiKey':'apiKey';
 const secret=({op,apiKey}={})=>{
  const saved=readJson(secretFile,{});
  if(op==='set'){const key=String(apiKey||'').trim();if(!key||key.length>1000)return {ok:false,error:'API_KEY_INVALID'};writeJson(secretFile,{...saved,[secretField]:key});return {ok:true,provider,configured:true};}
  if(op==='clear'){delete saved[secretField];if(Object.keys(saved).length)writeJson(secretFile,saved);else try{fs.unlinkSync(secretFile);}catch{}return {ok:true,provider,configured:false};}
  return {ok:true,provider,configured:!!saved[secretField]};
 };
 const status=({key}={})=>{const today=dayAt(now()),todayJobs=state.jobs.filter(j=>j.day===today),counts=limit();return {ok:true,provider,configured:secret({op:'status'}).configured&&!!model&&!!baseUrl,day:today,globalUsed:todayJobs.length,globalLimit:counts.global,sessionUsed:key?todayJobs.filter(j=>j.key===key).length:undefined,sessionLimit:counts.session,quotaMode:counts.mode};};
 async function outputImage(data){
  if(data?.b64_json){const b64=String(data.b64_json);if(b64.length>bounded(config.maxOutputBytes,10485760,30000000)*1.4+32)throw Error('IMAGE_TOO_LARGE');return Buffer.from(b64,'base64');}
  if(data?.url){const url=new URL(data.url);if(url.protocol!=='https:'||url.username||url.password)throw Error('IMAGE_URL_NOT_ALLOWED');const fetched=await safeFetchBuffer(url.href,bounded(config.maxOutputBytes,10485760,30000000));return fetched.buffer;}
  throw Error('IMAGE_RESPONSE_EMPTY');
 }
 async function run(job){
  try{
   if(signal?.aborted)throw Error('JOB_INTERRUPTED');
   const apiKey=readJson(secretFile,{})[secretField];if(!apiKey)throw Error('API_NOT_CONFIGURED');
   const maxRef=bounded(config.maxReferenceImages,1,5),maxRefBytes=bounded(config.maxReferenceBytes,10485760,30000000);
   const refs=job.referenceMessageId?await readReferences({key:job.key,messageId:job.referenceMessageId,maxImages:maxRef,maxBytes:maxRefBytes}):[];
   if(job.referenceMessageId&&(!Array.isArray(refs)||!refs.length))throw Error('REFERENCE_NOT_FOUND');
   if(refs.length>maxRef)throw Error('TOO_MANY_REFERENCES');
   let body,headers={authorization:`Bearer ${apiKey}`},endpoint='images/generations';
   if(provider==='ark'){
    const images=refs.map(ref=>{const bytes=Buffer.from(String(ref.data||''),'base64'),mime=imageType(bytes);if(!mime||bytes.length>maxRefBytes)throw Error('REFERENCE_INVALID');return `data:${mime};base64,${bytes.toString('base64')}`;});
    headers['content-type']='application/json';
    body=JSON.stringify({model,prompt:job.prompt,size,response_format:'b64_json',...(images.length?{image:images.length===1?images[0]:images}:{})});
   }else if(refs.length){endpoint='images/edits';body=new FormData();body.set('model',String(model));body.set('prompt',job.prompt);body.set('size',String(size));body.set('quality',String(config.quality||'auto'));for(let i=0;i<refs.length;i++){const bytes=Buffer.from(String(refs[i].data||''),'base64'),mime=imageType(bytes);if(!mime||bytes.length>maxRefBytes)throw Error('REFERENCE_INVALID');body.append(refs.length===1?'image':'image[]',new Blob([bytes],{type:mime}),`reference-${i}.${mime.split('/')[1]}`);}}
   else{headers['content-type']='application/json';body=JSON.stringify({model,prompt:job.prompt,size,quality:config.quality||'auto',n:1});}
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),bounded(config.timeoutSeconds,120,600)*1000);
   let response,parsed;
   try{
    response=await fetchImpl(apiUrl(endpoint),{method:'POST',headers,body,signal:controller.signal,redirect:'error',dispatcher:dispatcher()});
    if(!response.ok){
     let code='';
     if(response.body){try{const chunks=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>4096)break;chunks.push(Buffer.from(chunk));}const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));const candidate=String(parsed?.error?.code||'');if(/^[A-Za-z][A-Za-z0-9_-]{1,80}$/.test(candidate))code=candidate;}catch{}}
     throw Error('PROVIDER_HTTP_'+response.status+(code?'_'+code:''));
    }
    const jsonLimit=Math.ceil(bounded(config.maxOutputBytes,10485760,30000000)*1.4)+65536;
    if(Number(response.headers.get('content-length'))>jsonLimit)throw Error('IMAGE_RESPONSE_TOO_LARGE');
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>jsonLimit){controller.abort();throw Error('IMAGE_RESPONSE_TOO_LARGE');}chunks.push(Buffer.from(chunk));}
    parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   }finally{clearTimeout(timeout);}
   const bytes=await outputImage(parsed?.data?.[0]),max=bounded(config.maxOutputBytes,10485760,30000000),mime=imageType(bytes);
   if(!mime||!bytes.length||bytes.length>max)throw Error('OUTPUT_IMAGE_INVALID');
   if(signal?.aborted)throw Error('JOB_INTERRUPTED');
   const extension=mime==='image/png'?'png':mime==='image/jpeg'?'jpg':'webp';fs.writeFileSync(path.join(assets,job.id+'.'+extension),bytes,{mode:0o600});job.mimeType=mime;job.extension=extension;job.status='ready';save();
  }catch(error){if(signal?.aborted)return;job.status='failed';job.error=/^(?:API_|IMAGE_|REFERENCE_|TOO_MANY_|OUTPUT_|PROVIDER_HTTP_|PROXY_|JOB_)/.test(error.message)?error.message:'PROVIDER_REQUEST_FAILED';save();}
 }
 async function create({key,requestId,prompt,referenceMessageId,automatic=false}={}){
  prune();save();
  if(!validKey.test(String(key)))return {ok:false,error:'KEY_INVALID'};
  if(!validRequest.test(String(requestId)))return {ok:false,error:'REQUEST_ID_INVALID'};
  const input=String(prompt||'').trim(),max=bounded(config.maxPromptChars,1200,10000);
  if(!input||input.length>max)return {ok:false,error:'PROMPT_INVALID'};
  const ref=referenceMessageId===undefined||referenceMessageId===null?'':String(referenceMessageId);
  if(ref&&!/^-?[1-9]\d*$/.test(ref))return {ok:false,error:'REFERENCE_ID_INVALID'};
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify([input,ref,!!automatic])).digest('hex');
  const prior=state.jobs.find(j=>j.key===key&&j.requestId===requestId);
  if(prior)return prior.fingerprint===fingerprint?cleanJob(prior):{ok:false,error:'REQUEST_ID_CONFLICT'};
  if(automatic&&!config.allowAutomatic)return {ok:false,error:'AUTOMATIC_DISABLED'};
  if(Array.isArray(config.allowedSessions)&&config.allowedSessions.length&&!config.allowedSessions.includes(key))return {ok:false,error:'SESSION_NOT_ALLOWED'};
  if(!secret({op:'status'}).configured||!model||!baseUrl)return {ok:false,error:'API_NOT_CONFIGURED'};
  try{apiUrl('images/generations');}catch{return {ok:false,error:'API_BASE_INVALID'};}
  const limits=limit(),day=dayAt(now()),today=state.jobs.filter(j=>j.day===day);
  if(['global','both'].includes(limits.mode)&&today.length>=limits.global)return {ok:false,error:'GLOBAL_DAILY_LIMIT'};
  if(['session','both'].includes(limits.mode)&&today.filter(j=>j.key===key).length>=limits.session)return {ok:false,error:'SESSION_DAILY_LIMIT'};
  const last=state.jobs.filter(j=>j.key===key).at(-1),cooldown=bounded(config.cooldownSeconds,60,3600)*1000;
  if(last&&now()-last.createdAt<cooldown)return {ok:false,error:'COOLDOWN'};
  const job={id:crypto.randomUUID(),key,provider,requestId,prompt:input,referenceMessageId:ref,automatic:!!automatic,fingerprint,day,createdAt:now(),status:'pending'};
  state.jobs.push(job);save();void run(job);return cleanJob(job);
 }
 function get({key,jobId}={}){if(!validKey.test(String(key)))return {ok:false,error:'KEY_INVALID'};return cleanJob(state.jobs.find(j=>j.id===jobId&&j.key===key));}
 function asset({key,imageId}={}){const job=state.jobs.find(j=>j.id===imageId&&j.key===key&&j.status==='ready');if(!job)return {ok:false,error:'IMAGE_NOT_FOUND'};const filePath=path.join(assets,job.id+'.'+job.extension);try{return {ok:true,imageId:job.id,image:{mimeType:job.mimeType,data:fs.readFileSync(filePath).toString('base64')}};}catch{return {ok:false,error:'IMAGE_NOT_FOUND'};}}
 function claimSend({key,imageId}={}){const job=state.jobs.find(j=>j.id===imageId&&j.key===key&&j.status==='ready');if(!job)return {ok:false,error:'IMAGE_NOT_FOUND'};if(job.delivery)return {ok:false,error:'IMAGE_DELIVERY_ALREADY_ATTEMPTED',status:job.delivery};job.delivery='sending';save();return {ok:true};}
 function finishSend({key,imageId,success}={}){const job=state.jobs.find(j=>j.id===imageId&&j.key===key&&j.delivery==='sending');if(!job)return {ok:false,error:'IMAGE_SEND_NOT_CLAIMED'};job.delivery=success?'sent':'unknown';save();return {ok:true,status:job.delivery};}
 return {create,get,asset,status,secret,claimSend,finishSend};
}
