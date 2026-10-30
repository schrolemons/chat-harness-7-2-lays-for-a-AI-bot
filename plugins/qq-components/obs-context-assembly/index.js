
import {inspectKnowledge,knowledgeModules} from './knowledge.mjs';
import {randomUUID} from 'node:crypto';

import {encodePacket,decodePacket} from './packet.mjs';


import {prioritizeChatExpression} from './chat-expression.mjs';
import {REFRESH_MODULE_IDS} from './refill.mjs';
const owned=file=>{const url=new URL(file,import.meta.url);url.search=new URL(import.meta.url).search;return import(url.href);};
const [{moduleCatalog,completeModuleSlots},{compileModules,normalizePolicy},{readPolicy,secretFor,recordEvidence,readEvidence,listAssemblies},{enrichRequestProvenance},{frameModules},{refreshReceiptIndex}]=await Promise.all(['./catalog.mjs','./policy.mjs','./store.mjs','./provenance.mjs','./frame.mjs','./message-snapshot.mjs'].map(owned));
export function createPlugin(ctx){
 const secret=secretFor(ctx.root),catalog=moduleCatalog(ctx.root);
 const runtime=ctx.runtime||{},seeds=runtime.contextSeeds||(runtime.contextSeeds=new Map());
 return {
  hooks:{beforePrompt(payload){seeds.set(payload.key,{...payload});if(seeds.size>128)seeds.delete(seeds.keys().next().value);}},
  validateConfig(config){try{normalizePolicy(config);return {ok:true};}catch(error){return {ok:false,errors:[error.message]};}},
  services:{contextAssembly:{
   refresh({sessionId,envelope}={}){
    const packet=decodePacket(envelope,secret,sessionId),capture=packet?readEvidence(ctx.root,packet.key):null;
    if(!packet||capture?.nonce!==packet.nonce||capture.sessionId!==sessionId)return {ok:false,error:'context 会话或签名已失效'};
    const fresh=ctx.capabilities?.refreshContextModules?.({key:packet.key,sessionId,scene:packet.scene,seed:seeds.get(packet.key),moduleIds:REFRESH_MODULE_IDS});
    if(!fresh?.modules)return {ok:false,error:'当前运行程序尚未提供逐请求刷新能力'};
    const componentIds=new Set(REFRESH_MODULE_IDS);
    const kept=packet.modules.filter(row=>!componentIds.has(row.id)).map(row=>refreshReceiptIndex(row,fresh.receiptState));
    const background=packet.modules.find(row=>row.id==='session-background')?.text;
    let modules=completeModuleSlots([...kept,...fresh.modules],catalog).map(row=>{
     if(row.id==='ctx-context-session'&&background)row={...row,text:row.text.replace(background,'').trim()};
     return row.id==='ctx-context-dynamics'&&fresh.expression?{...row,chatExpression:fresh.expression}:row;
    });
    modules=prioritizeChatExpression(knowledgeModules(modules,inspectKnowledge(ctx,packet.key),true),readPolicy(ctx.root));
    const compiled=compileModules(modules,readPolicy(ctx.root),packet.scene);
    recordEvidence(ctx.root,packet.key,'assembly',{...capture,modules:compiled.modules,beforeChars:compiled.beforeChars,afterChars:compiled.afterChars,refreshedAt:Date.now()});
    return {ok:true,envelope:encodePacket({...packet,modules,refreshedAt:Date.now()},secret)};
   },
   frame(input){const expression=ctx.callService?.('chatExpression','current',{key:input.key});const modules=frameModules(input).map(row=>row.id==='ctx-context-dynamics'&&expression?{...row,chatExpression:expression}:row);return this.compose({...input,modules});},
   compose({key,sessionId,scene,modules,fallback}){
    modules=knowledgeModules(completeModuleSlots(modules,catalog),inspectKnowledge(ctx,key),true);
    const nonce=randomUUID(),policy=readPolicy(ctx.root);modules=prioritizeChatExpression(modules,policy);const compiled=compileModules(modules,policy,scene);
    const consumer=readEvidence(ctx.root,sessionId,'consumer');
    let ready=false;
    if(consumer?.pid&&consumer?.sessionId===sessionId)try{process.kill(consumer.pid,0);ready=true;}catch{}
    // Until the receiving preset has acknowledged this session, preserve the working transport.
    const active=policy.enabled&&Boolean(ready);
    recordEvidence(ctx.root,key,'assembly',{key,sessionId,scene,nonce,at:Date.now(),active,modules:compiled.modules,beforeChars:compiled.beforeChars,afterChars:compiled.afterChars});
    if(!active)return fallback;
    return encodePacket({version:1,key,sessionId,scene,modules,nonce,issuedAt:Date.now()},secret);
   },
   inspect({key,draft}={}){
    const sessions=listAssemblies(ctx.root),policy=readPolicy(ctx.root),capture=key?readEvidence(ctx.root,key):null;
    const knowledge=inspectKnowledge(ctx,key),preview=capture?compileModules(prioritizeChatExpression(knowledgeModules(completeModuleSlots(capture.modules,catalog),knowledge),draft||policy),draft||policy,capture.scene):null;
    const request=capture?enrichRequestProvenance(ctx.root,readEvidence(ctx.root,capture.sessionId,'request')):null;
    const requestMatchesCapture=capture?.nonce&&request?.nonce?capture.nonce===request.nonce:null;
    return {ok:true,policy,sessions,capture,preview,knowledge,catalog,request,requestStages:request?.requestStages,requests:request?.recentRequests||(request?[request]:[]),requestMatchesCapture};
   }
  }}
 };
}
