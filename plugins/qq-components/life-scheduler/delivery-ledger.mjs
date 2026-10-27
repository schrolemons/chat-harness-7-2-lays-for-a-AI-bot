// A shared receipt file for in-process plugins and standalone local notification producers.
// Intent is persisted BEFORE sending. An unknown outcome stays suppressed until operator review.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
export function createDeliveryLedger({file,now=Date.now}) {
 const lock=file+'.lock';
 function transact(fn){let held=false,temp;
  try{fs.mkdirSync(path.dirname(file),{recursive:true});
   try{const fd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(fd,String(process.pid));fs.closeSync(fd);held=true;}catch(e){
    if(e.code!=='EEXIST')throw e;
    // Never reclaim a stale lock automatically: two reclaimers can otherwise delete
    // each other's new live lock. Operator recovery must be exclusive.
    return {ok:false,reason:'ledger_busy'};
   }
   let state={version:1,receipts:{}};try{state=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')return {ok:false,reason:'ledger_invalid'};}
   if(!state.receipts||typeof state.receipts!=='object')return {ok:false,reason:'ledger_invalid'};
   const out=fn(state);temp=file+'.tmp-'+process.pid+'-'+crypto.randomBytes(4).toString('hex');fs.writeFileSync(temp,JSON.stringify(state),{mode:0o600});fs.renameSync(temp,file);return out;
  }catch{return {ok:false,reason:'ledger_unavailable'};}finally{if(temp&&fs.existsSync(temp))try{fs.unlinkSync(temp);}catch{}if(held)try{fs.unlinkSync(lock);}catch{}}
 }
 const axis=id=>crypto.createHash('sha256').update(String(id)).digest('hex');
 return {
  claim({id,expiresAt,sourceAt}={}){if(!id)return {ok:false,reason:'missing_id'};return transact(s=>{const t=now(),key=axis(id);if(Number.isFinite(expiresAt)&&t>expiresAt)return {ok:false,reason:'expired'};if(s.receipts[key])return {ok:false,reason:s.receipts[key].status};s.receipts[key]={at:t,status:'claimed',sourceAt:sourceAt||t};return {ok:true};});},
  finish(id,sent){return transact(s=>{const entry=s.receipts[axis(id)];if(!entry)return {ok:false,reason:'not_claimed'};entry.status=sent===true?'sent':'uncertain';entry.finishedAt=now();return {ok:true};});},
  status(id){
   if(!id)return {ok:false,reason:'missing_id'};
   try{const state=JSON.parse(fs.readFileSync(file,'utf8'));if(!state.receipts||typeof state.receipts!=='object')return {ok:false,reason:'ledger_invalid'};const entry=state.receipts[axis(id)];return {ok:true,status:entry?.status||'absent',at:Number(entry?.at)||0,finishedAt:Number(entry?.finishedAt)||0};}
   catch(e){if(e.code==='ENOENT')return {ok:true,status:'absent',at:0,finishedAt:0};return {ok:false,reason:'ledger_invalid'};}
  }
 };
}
