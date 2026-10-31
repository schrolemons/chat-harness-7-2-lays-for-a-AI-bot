import test from 'node:test';import assert from 'node:assert/strict';
import {createStartupNotebook} from './startup-notebook.mjs';
test('actual process boots append once, hot reload stays quiet, next boot records interval',()=>{
 let state={},now=1000000;const lines=[],ctx={state:{get:()=>state,set:p=>state={...state,...p}}},append=text=>{lines.push(text);return {ok:true};};
 const a=createStartupNotebook(ctx,append,{bootId:'boot-a',startedAt:now,clock:()=>now});a.flush();a.flush();assert.equal(lines.length,1);
 createStartupNotebook(ctx,append,{bootId:'boot-a',startedAt:now,clock:()=>now}).flush();assert.equal(lines.length,1);
 now+=120000;createStartupNotebook(ctx,append,{bootId:'boot-b',startedAt:now,clock:()=>now}).flush();assert.equal(lines.length,2);assert.match(lines[1],/2分钟/);assert.match(lines[1],/启动|重启/);
});
test('failed appends retry without marking success; a disabled lifecycle cannot write',()=>{
 let state={},calls=0,active=true;const ctx={state:{get:()=>state,set:p=>state={...state,...p}},isActive:()=>active};const n=createStartupNotebook(ctx,()=>({ok:++calls>1}),{bootId:'b',startedAt:1,clock:()=>1});
 n.flush();assert(!state.startupNotebook);n.flush();assert.equal(calls,2);n.flush();assert.equal(calls,2);active=false;createStartupNotebook(ctx,()=>{throw Error('disabled');},{bootId:'c',startedAt:2,clock:()=>2}).flush();
});
