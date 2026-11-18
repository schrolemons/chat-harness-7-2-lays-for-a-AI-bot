import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {runReadOnlyWorker} from '../src/read-only-worker.mjs';
import {apply as restrictSummary} from '../plugins/qq-agent-presets/memory-tool-restrict.mjs';
const ok=value=>({result:{ok:true,value}});
function fixture({tools=false}={}){
 let socket,streamId;const calls=[];
 class Socket extends EventEmitter{constructor(){super();socket=this;queueMicrotask(()=>this.emit('open'));}send(value){streamId=JSON.parse(value).streamId;queueMicrotask(()=>emit({type:'snapshot'}));}close(){this.emit('close');}}
 const emit=value=>socket.emit('message',JSON.stringify({streamId,type:'item',value}));
 const api={baseUrl:'http://127.0.0.1:1',cookie:'isolated-fixture',sessionPolicy:{resolvePreset:p=>'fixture:'+p},agentPresets:{list:async()=>ok({presets:[{id:'fixture:qq-memory-worker'}]})},
 sessions:{create:async p=>{calls.push(['create',p]);return ok({sessionId:'worker-only'});},prompt:async p=>{calls.push(['prompt',p]);queueMicrotask(()=>{emit({type:'event',event:{type:'request/header',data:{header:{tools:tools?[{name:'forbidden'}]:[]}}}});emit({type:'event',event:{type:'assistant/message',data:{message:{content:[{type:'text',text:'draft'}]}}}});emit({type:'event',event:{type:'turn/end',data:{reason:{kind:'completed'}}}});});return ok({accepted:true});},cancel:async p=>calls.push(['cancel',p])},callUnary:async(...p)=>calls.push(['archive',...p])};
 return {api,Socket,calls};
}
test('isolated read-only worker uses no chat session and archives its own native session',async()=>{
 const f=fixture(),r=await runReadOnlyWorker({api:f.api,prompt:'trusted policy plus quoted data',WebSocketImpl:f.Socket});assert.equal(r.text,'draft');assert.equal(f.calls[0][1].agentPreset,'qq-memory-worker');assert.equal(f.calls[1][1].sessionId,'worker-only');assert.equal(f.calls.at(-1)[0],'archive');assert(!f.calls.some(c=>c[0]==='cancel'));
});
test('a tool-bearing worker request is cancelled and never accepted as a successful draft',async()=>{
 const f=fixture({tools:true});await assert.rejects(runReadOnlyWorker({api:f.api,prompt:'draft',WebSocketImpl:f.Socket}),/Tool-free/);assert(f.calls.some(c=>c[0]==='cancel'));
});
test('explicit image-reader content uses the same tool-free worker boundary without a chat credential',async()=>{
 const f=fixture(),content=[{type:'text',text:'整理图片事实'},{type:'image',mediaType:'image/png',data:'fixture'}];
 await runReadOnlyWorker({api:f.api,content,WebSocketImpl:f.Socket});
 const submitted=f.calls.find(c=>c[0]==='prompt')[1];assert.deepEqual(submitted.content,content);assert.equal(submitted.token,undefined);assert.equal(f.calls.at(-1)[0],'archive');
});
test('the memory preset removes inherited team tools from the final assembled request',async()=>{
 const hooks={};restrictSummary({tools:{restrict(){},guard(){}},on:(name,fn)=>hooks[name]=fn});
 assert.equal(typeof hooks['system-prompt/assemble'],'function');
 const r=await hooks['system-prompt/assemble']({}, {},async()=>({tools:[{name:'spawn_teammate'},{name:'team_task_create'}],sections:[{text:'preserve prompt'}]}));
 assert.deepEqual(r.tools,[]);assert.equal(r.sections[0].text,'preserve prompt');
});
test('cancelling a connecting socket retains its error listener before closing',async()=>{
 const f=fixture(),controller=new AbortController();let closed=false;
 class ConnectingSocket extends EventEmitter{
  constructor(){super();controller.abort(Error('cancelled while connecting'));}
  close(){closed=true;assert(this.listenerCount('error')>0,'Connecting close must already handle WebSocket errors');this.emit('error',Error('WebSocket was closed before the connection was established'));this.emit('close');}
 }
 await assert.rejects(runReadOnlyWorker({api:f.api,prompt:'fixture',signal:controller.signal,WebSocketImpl:ConnectingSocket}),/cancelled while connecting/);
 assert(closed);assert(f.calls.some(c=>c[0]==='cancel'));assert.equal(f.calls.at(-1)[0],'archive');
});
test('an abort during model preparation never creates a new event connection',async()=>{
 const f=fixture(),controller=new AbortController();let opened=false;
 class UnexpectedSocket extends EventEmitter{constructor(){super();opened=true;}close(){}}
 await assert.rejects(runReadOnlyWorker({api:f.api,prompt:'fixture',signal:controller.signal,prepare:async()=>controller.abort(Error('preparation cancelled')),WebSocketImpl:UnexpectedSocket}),/preparation cancelled/);
 assert.equal(opened,false);assert(f.calls.some(c=>c[0]==='cancel'));
});
