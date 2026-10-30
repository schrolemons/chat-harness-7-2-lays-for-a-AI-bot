import test from 'node:test';import assert from 'node:assert/strict';
import {createSessionRecoveryCapability,sessionRecoveryObservation} from '../src/bridge-core/session-recovery.mjs';
function fixture(){const calls=[],controller=new AbortController();let current='old';const cap=createSessionRecoveryCapability({inspect:async()=>({sessionId:current}),confirm:()=>true,stop:async id=>calls.push('stop:'+id),archive:async id=>calls.push('archive:'+id),detach:(key,id)=>{assert.equal(current,id);calls.push('detach:'+key);current=null;},create:async key=>{calls.push('create:'+key);current='new';return current;},resume:key=>calls.push('resume:'+key)});return {cap,calls,controller,current:()=>current};}
test('single-group recovery stops before archival and replacement, without clearing conversation data',async()=>{const f=fixture();const result=await f.cap.recover({key:'group:456',sessionId:'old',signal:f.controller.signal});assert.deepEqual(result,{ok:true,sessionId:'new'});assert.deepEqual(f.calls,['stop:old','archive:old','detach:group:456','create:group:456','resume:group:456']);});
test('private targets, revoked authorization, cancellation and changed mappings never reach stop',async()=>{
 const f=fixture();assert.equal((await f.cap.recover({key:'private:123',sessionId:'old'})).skipped,true);assert.deepEqual(f.calls,[]);
 const calls=[];const cap=createSessionRecoveryCapability({inspect:async()=>({sessionId:'new'}),confirm:()=>true,stop:async()=>calls.push('stop')});assert.equal((await cap.recover({key:'group:456',sessionId:'old'})).skipped,true);assert.deepEqual(calls,[]);
 const denied=createSessionRecoveryCapability({inspect:async()=>({sessionId:'old'}),confirm:()=>false,stop:async()=>calls.push('stop')});assert.equal((await denied.recover({key:'group:456',sessionId:'old'})).skipped,true);
 f.controller.abort();assert.equal((await f.cap.recover({key:'group:456',sessionId:'old',signal:f.controller.signal})).skipped,true);assert.deepEqual(f.calls,[]);
});
test('stop and archive failures never detach or create, and overlapping recovery cannot act twice',async()=>{
 for(const fail of ['stop','archive']){const calls=[];const cap=createSessionRecoveryCapability({inspect:async()=>({sessionId:'old'}),confirm:()=>true,stop:async()=>{calls.push('stop');if(fail==='stop')throw Error();},archive:async()=>{calls.push('archive');throw Error();},detach:()=>calls.push('detach'),create:()=>calls.push('create')});assert.equal((await cap.recover({key:'group:456',sessionId:'old'})).ok,false);assert(!calls.includes('detach'));}
 let release;const cap=createSessionRecoveryCapability({inspect:()=>new Promise(r=>release=r),confirm:()=>false});const pending=cap.recover({key:'group:456',sessionId:'old'});assert.equal(cap.isRecovering('group:456'),true);assert.equal((await cap.recover({key:'group:456',sessionId:'old'})).skipped,true);release({sessionId:'old'});await pending;assert.equal(cap.isRecovering('group:456'),false);
});
test('observations carry request failures and progress, without persisting tool arguments or message text',()=>{
 const meta={key:'group:456',sessionId:'old',reason:'message',now:100};
 const event=sessionRecoveryObservation({type:'tool/call',seq:4,data:{turn:1,arguments:{token:'secret'},name:'x'}},meta);assert.equal(event.progress,true);assert(!JSON.stringify(event).includes('secret'));
 const ended=sessionRecoveryObservation({type:'turn/end',seq:5,data:{turn:1,reason:{kind:'error',error:{code:'INVALID_REQUEST',status:400,message:'bad request'}}}},meta);assert.equal(ended.failure.status,400);
 assert.equal(sessionRecoveryObservation({type:'assistant/message',seq:6,data:{turn:1,message:{content:[{type:'text',text:'normal reply'}]}}},meta).progress,true);
});
