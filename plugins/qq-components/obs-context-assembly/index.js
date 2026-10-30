import {moduleCatalog,completeModuleSlots} from './catalog.mjs';
import {inspectKnowledge,knowledgeModules} from './knowledge.mjs';
import {randomUUID} from 'node:crypto';
import {compileModules,normalizePolicy} from './policy.mjs';
import {encodePacket} from './packet.mjs';
import {frameModules} from './frame.mjs';
import {readPolicy,secretFor,recordEvidence,readEvidence,listAssemblies} from './store.mjs';
export function createPlugin(ctx){
 const secret=secretFor(ctx.root),catalog=moduleCatalog(ctx.root);
 return {
  validateConfig(config){try{normalizePolicy(config);return {ok:true};}catch(error){return {ok:false,errors:[error.message]};}},
  services:{contextAssembly:{
   frame(input){return this.compose({...input,modules:frameModules(input)});},
   compose({key,sessionId,scene,modules,fallback}){
    modules=knowledgeModules(completeModuleSlots(modules,catalog),inspectKnowledge(ctx,key),true);
    const nonce=randomUUID(),policy=readPolicy(ctx.root),compiled=compileModules(modules,policy,scene);
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
    const knowledge=inspectKnowledge(ctx,key),preview=capture?compileModules(knowledgeModules(completeModuleSlots(capture.modules,catalog),knowledge),draft||policy,capture.scene):null;
    const request=capture?readEvidence(ctx.root,capture.sessionId,'request'):null;
    const requestMatchesCapture=capture?.nonce&&request?.nonce?capture.nonce===request.nonce:null;
    return {ok:true,policy,sessions,capture,preview,knowledge,catalog,request,requestStages:request?.requestStages,requests:request?.recentRequests||(request?[request]:[]),requestMatchesCapture};
   }
  }}
 };
}
