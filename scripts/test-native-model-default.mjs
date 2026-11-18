import test from 'node:test';import assert from 'node:assert/strict';
import {createPreservingModelSelector} from '../src/native-model-default.mjs';
const ordinary={provider:'chosen',model:'global',reasoningEffort:'off'};
function fixture({duringSelection,duringRestore,fail}={}){
 let value={...ordinary},revision=1;const calls=[];
 const change=next=>{value={...next};revision++;};
 const select=createPreservingModelSelector({
  readDefault:async()=>({value:{...value},revision}),
  writeDefault:async(next,expected)=>{if(duringRestore)duringRestore(change);if(revision!==expected)throw Error('revision conflict');change(next);},
  selectModel:async selection=>{calls.push(selection);const selected={provider:selection.provider,model:selection.model,reasoningEffort:selection.reasoningEffort};change(selected);if(duringSelection)duringSelection(change);if(fail)throw Error('selection response lost');return {selected};}
 });return {select,value:()=>value,calls};
}
test('worker and vision model selections preserve the actual user global default',async()=>{
 const f=fixture();await Promise.all([f.select({sessionId:'worker',provider:'paid',model:'special',reasoningEffort:'high'}),f.select({sessionId:'vision',provider:'vision',model:'image',reasoningEffort:'off'})]);
 assert.deepEqual(f.value(),ordinary);assert.equal(f.calls.length,2);assert.equal(f.calls[0].sessionId,'worker');
});
test('a user changes the default during a worker selection or its CAS restore',async()=>{
 const chosen={provider:'new-user-choice',model:'new-model',reasoningEffort:'low'};
 for(const hook of ['duringSelection','duringRestore']){const f=fixture({[hook]:change=>change(chosen)});await f.select({provider:'worker',model:'special',reasoningEffort:'off'});assert.deepEqual(f.value(),chosen);}
});
test('a lost selection response still restores only its own global side effect',async()=>{
 const f=fixture({fail:true});await assert.rejects(f.select({provider:'worker',model:'special',reasoningEffort:'off'}),/response lost/);assert.deepEqual(f.value(),ordinary);
});
test('a delayed native default save after selectModel resolves is observed before restoration',async()=>{
 let value={...ordinary},revision=1;
 const select=createPreservingModelSelector({readDefault:async()=>({value:{...value},revision}),writeDefault:async(next,expected)=>{assert.equal(revision,expected);value={...next};revision++;},selectModel:async selection=>{setTimeout(()=>{value={provider:selection.provider,model:selection.model,reasoningEffort:selection.reasoningEffort};revision++;},20);return {selected:selection};}});
 await select({provider:'vision',model:'image',reasoningEffort:'off'});
 await new Promise(r=>setTimeout(r,40));assert.deepEqual(value,ordinary);
});
