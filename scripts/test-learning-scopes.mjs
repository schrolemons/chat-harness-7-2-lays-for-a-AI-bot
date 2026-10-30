import test from 'node:test';import assert from 'node:assert/strict';
import {sourceKeys,migrateScope,defaultEntries,queryEntries,lookupHints,changeCurrentSource} from '../plugins/qq-components/learning-scopes.mjs';
const term={id:'t1',term:'Rust',aliases:['锈语言'],topic:'编程',summary:'PRIVATE SUMMARY',status:'confirmed',originKey:'group:10001',sourceKeys:['group:10001','private:10002'],evidence:[{key:'group:10001',text:'PRIVATE EVIDENCE'}]};
test('multi-session defaults obey source membership, independent caps and zero',()=>{
 assert.deepEqual(sourceKeys(['group:10001','private:10002','group:10001']),['group:10001','private:10002']);assert.throws(()=>sourceKeys(['*']));
 assert.equal(defaultEntries([term],'term','group:10001',3).length,1);assert.equal(defaultEntries([term],'term','group:10003',3).length,0);assert.equal(defaultEntries([term],'term','group:10001',0).length,0);
});
test('cross-session queries require exact name and never disclose provenance or evidence',()=>{
 assert.equal(queryEntries([term],'term',{key:'group:10003',q:'Rus'}).entries.length,0);assert.equal(queryEntries([term],'term',{key:'group:10003'}).entries.length,0);
 const result=queryEntries([term],'term',{key:'group:10003',q:'rust'});assert.equal(result.entries.length,1);assert(!JSON.stringify(result).includes('PRIVATE EVIDENCE'));assert(!JSON.stringify(result).includes('group:10001'));
 assert.equal(queryEntries([{...term,status:'candidate'}],'term',{key:'group:10003',q:'Rust'}).entries.length,0);
});
test('exact incoming names and actual sender QQ produce queries instead of cross-source injection',()=>{
 assert.equal(lookupHints([term],'term',{key:'group:10003',incomingText:'Trust me'}),'');assert.match(lookupHints([term],'term',{key:'group:10003',incomingText:'想问Rust语言'}),/qq_term_query/);
 assert.match(lookupHints([{id:'a',alias:'小明',qq:'10002',status:'confirmed',sourceKeys:[]}],'alias',{key:'group:10003',userIds:['10002']}),/q="10002"/);
});
test('source edits change current membership without approving candidates or moving records',()=>{
 const entry=structuredClone(term),list=[entry];assert.equal(changeCurrentSource(list,{key:'group:10003',id:'t1',action:'include_here'}).ok,true);assert.equal(entry.originKey,'group:10001');assert.deepEqual(entry.evidence,term.evidence);assert.equal(entry.id,'t1');assert(entry.sourceKeys.includes('private:10002'));
 changeCurrentSource(list,{key:'group:10003',id:'t1',action:'exclude_here'});assert(!entry.sourceKeys.includes('group:10003'));assert.equal(changeCurrentSource([{...entry,status:'candidate'}],{key:'group:10003',id:'t1',action:'include_here'}).ok,false);
});
test('one-time migration preserves origin and meaning while retiring single-source applicability',()=>{
 const migrated=migrateScope({id:'old',sourceKey:'group:10001',summary:'fact',evidence:[{key:'private:10002'}]});assert.deepEqual(migrated.sourceKeys,['group:10001','private:10002']);assert.equal(migrated.originKey,'group:10001');assert.equal(migrated.summary,'fact');assert(!('sourceKey'in migrated));assert.deepEqual(migrateScope(migrated),migrated);
});

test('three real components respect independent zero caps and persist source changes',async()=>{
 for(const [kind,file,record]of [
 ['term','ctx-interest-terms/index.js',{id:'t',term:'独立词条',topic:'测试',summary:'TERM_DEFINITION',status:'confirmed',sourceKeys:['group:10001']}],
 ['alias','ctx-member-alias/index.js',{id:'a',alias:'独立昵称',qq:'20009',status:'confirmed',sourceKeys:['group:10001']}]
 ]){
   const {createPlugin}=await import('../plugins/qq-components/'+file);let state={entries:[record]};
   const ctx={config:{injectMax:0,autoExtract:false},runtime:{},signal:new AbortController().signal,isActive:()=>true,state:{get:()=>structuredClone(state),set:p=>Object.assign(state,structuredClone(p))},capabilities:{},registerTool:()=>{},warn:()=>{},log:()=>{}};
   const plugin=createPlugin(ctx),service=plugin.services[kind==='term'?'terms':'aliases'];
   const prompt=plugin.hooks.beforePrompt({key:'group:10001',incomingText:''});assert(!prompt.includes(kind==='term'?'TERM_DEFINITION':'- 独立昵称 ='));
   assert.equal(service.query({key:'group:10002',q:kind==='term'?record.term:record.qq}).entries.length,1);
   assert.equal(service.updateSources({key:'group:10002',id:record.id,action:'include_here'}).ok,true);assert(state.entries[0].sourceKeys.includes('group:10002'));
   ctx.config.injectMax=1;assert(plugin.hooks.beforePrompt({key:'group:10002'}).includes(kind==='term'?'TERM_DEFINITION':'- 独立昵称 ='));
 }
 const {createPlugin}=await import('../plugins/qq-components/ctx-chat-slang/index.js');let rows=[{id:'s',content:'独立黑话',meaning:'SLANG_DEFINITION',status:'confirmed',originKey:'group:10001',sourceKeys:['group:10001']}],cfg={injectMax:0};
 const plugin=createPlugin({config:{},capabilities:{slangConfig:()=>cfg,slangList:()=>structuredClone(rows),slangSave:list=>(rows=structuredClone(list),true)},registerTool:()=>{},warn:()=>{},log:()=>{}});
 assert(!plugin.services.slang.contextBlock({key:'group:10001'}).includes('SLANG_DEFINITION'));assert.equal(plugin.services.slang.query({key:'group:10002',q:'独立黑话'}).entries.length,1);
 assert.equal(plugin.services.slang.updateSources({key:'group:10002',id:'s',action:'include_here'}).ok,true);cfg.injectMax=1;assert(plugin.services.slang.contextBlock({key:'group:10002'}).includes('SLANG_DEFINITION'));
});
