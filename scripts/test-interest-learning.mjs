import test from 'node:test';
import assert from 'node:assert/strict';
async function fixture(config={}) {
  const {createPlugin}=await import('../plugins/qq-components/ctx-interest-terms/index.js');
  let state={};const tools=new Map(),prompts=[];
  const ctx={config:{autoExtract:true,autoResearch:false,minMessages:2,cooldownMs:1,...config},runtime:{},signal:new AbortController().signal,isActive:()=>true,
    state:{get:()=>structuredClone(state),set:p=>(state={...state,...structuredClone(p)})},
    registerTool:(n,s)=>tools.set(n,s),log:()=>{},warn:()=>{},
    capabilities:{learningPrompt:async prompt=>{prompts.push(prompt);return JSON.stringify({entries:[{term:'摸金撤离',topic:'三角洲行动',category:'游戏玩法',summary:'搜索物资并完成撤离。',sourceIds:[1]}]});}}};
  return {ctx,plugin:createPlugin(ctx),state:()=>state,prompts,call:(n,i={})=>tools.get(n).handler(i)};
}
test('term submission is a candidate and cannot change confirmed public knowledge',async()=>{
  const h=await fixture();const a=await h.call('term_submit',{key:'group:456',term:'摸金撤离',topic:'三角洲行动',category:'游戏玩法',summary:'先收集物资再撤离'});
  assert.equal(a.entry.status,'candidate');assert.equal(h.plugin.hooks.beforePrompt({key:'group:456',incomingText:'摸金撤离'}).includes('先收集物资'),false);
  await h.call('term_save',{...a.entry,summary:'已核实玩法摘要',status:'confirmed',sources:['https://df.qq.com/']});
  await h.call('term_submit',{key:'group:456',term:'摸金撤离',topic:'三角洲行动',summary:'错误覆盖'});
  assert.equal(h.state().entries[0].summary,'已核实玩法摘要');
});
test('candidate extraction quota does not block manual research or consume its calls',async()=>{
  const h=await fixture({maxCallsPerHour:2}),now=Date.now();
  h.ctx.state.set({calls:[now-1000,now-2000,now-3700000]});
  const result=await h.call('term_list');
  assert.equal(result.budget.limit,2);assert.equal(result.budget.used,2);assert.equal(result.budget.remaining,0);
  assert.equal(result.budget.nextAvailableAt,now-2000+3600000);
  const candidate=await h.call('term_submit',{term:'兽聚',topic:'furry',category:'文化与活动'});
  h.ctx.capabilities.learningPrompt=async()=>JSON.stringify({summary:'公开活动的具体安排由组织方决定。',sources:['https://www.anthrocon.org/']});
  assert.equal((await h.call('term_research',{id:candidate.entry.id})).ok,true);
  assert.equal(h.state().calls.length,3);
  await h.plugin.hooks.onIncoming({key:'group:456',text:'三角洲玩法',messageId:'a'});
  await h.plugin.hooks.onIncoming({key:'group:456',text:'撤离路线',messageId:'b'});
  assert.equal((await h.call('term_extract',{key:'group:456'})).ok,false);
});
test('gameplay entries exclude entering or leaving circles; culture entries remain supported',async()=>{
  const h=await fixture();assert.equal((await h.call('term_submit',{term:'入圈指南',topic:'三角洲行动',category:'游戏玩法',summary:'教你入圈与退圈'})).ok,false);
  assert.equal((await h.call('term_submit',{term:'兽聚',topic:'furry',category:'文化与活动',summary:'公开的同好活动'})).ok,true);
});
test('confirmed entries inject only relevant topics and respect group scope',async()=>{
  const h=await fixture();await h.call('term_save',{term:'摸金撤离',topic:'三角洲行动',category:'游戏玩法',summary:'玩法知识',status:'confirmed',sources:['https://df.qq.com/']});
  await h.call('term_save',{term:'兽聚',topic:'furry',category:'文化与活动',summary:'活动知识',status:'confirmed',sourceKey:'group:789',sources:['https://example.org/']});
  assert.match(h.plugin.hooks.beforePrompt({key:'group:456',incomingText:'三角洲摸金撤离怎么玩'}),/玩法知识/);
  assert.doesNotMatch(h.plugin.hooks.beforePrompt({key:'group:456',incomingText:'你好'}),/玩法知识|活动知识/);
  assert.equal((await h.call('term_query',{key:'group:456',q:'furry'})).entries.length,0);
});
test('group collection deduplicates hooks, ignores private messages, and batches learning',async()=>{
  const h=await fixture();await h.plugin.hooks.onIncoming({key:'private:123',text:'私人话题',messageId:'p'});
  const m={key:'group:456',text:'三角洲这个打法不错',messageId:'a',userId:'10608'};
  await h.plugin.hooks.onIncoming(m);await h.plugin.hooks.onIncoming(m);
  await h.plugin.hooks.onIncoming({...m,text:'撤离路线怎么选',messageId:'b'});
  await h.plugin.hooks.onTick({now:Date.now()});
  assert.equal(h.prompts.length,1);assert.equal(h.state().entries[0].status,'candidate');
  assert.equal(h.state().entries[0].sourceKey,'group:456');assert.ok(h.state().entries[0].evidence.length);
});
test('research may keep a useful summary without a reference URL and never automatically confirms it',async()=>{
  const h=await fixture();const a=await h.call('term_submit',{term:'兽聚',topic:'furry',category:'文化与活动'});
  h.ctx.capabilities.learningPrompt=async()=>JSON.stringify({summary:'不同公开活动的安排由各自主办方决定。',sources:[]});
  const noSource=await h.call('term_research',{id:a.entry.id});assert.equal(noSource.ok,true);
  assert.equal(noSource.entry.status,'candidate');assert.deepEqual(noSource.entry.sources,[]);
  h.ctx.capabilities.learningPrompt=async()=>JSON.stringify({summary:'活动因主办方而异，不能代表所有成员。',sources:['https://www.anthrocon.org/']});
  const good=await h.call('term_research',{id:a.entry.id});assert.equal(good.ok,true);
  assert.equal(h.state().entries[0].status,'candidate');assert.equal(h.state().entries[0].research.status,'researched');
});
test('administrator can confirm a summarized term without a reference URL',async()=>{
  const h=await fixture();
  const saved=await h.call('term_save',{term:'群内活动',topic:'福瑞',summary:'公开活动由各自主办方安排。',status:'confirmed'});
  assert.equal(saved.ok,true);assert.equal(saved.entry.status,'confirmed');assert.deepEqual(saved.entry.sources,[]);
});
test('late research cannot resurrect a rejected entry or update a disposed plugin',async()=>{
  const h=await fixture();const a=await h.call('term_submit',{term:'兽聚',topic:'furry',category:'文化与活动'});let release;
  h.ctx.capabilities.learningPrompt=()=>new Promise(r=>release=r);
  const pending=h.call('term_research',{id:a.entry.id});await new Promise(r=>setTimeout(r,0));
  await h.call('term_reject',{id:a.entry.id});release(JSON.stringify({summary:'迟到的输出',sources:['https://example.org/']}));
  await pending;assert.equal(h.state().entries[0].status,'rejected');
});
test('repeated evidence cannot erase researched knowledge or its supporting sources',async()=>{
 const h=await fixture(),a=await h.call('term_submit',{term:'兽聚',topic:'furry',category:'文化与活动'});
 h.ctx.capabilities.learningPrompt=async()=>JSON.stringify({summary:'有来源的研究摘要',sources:['https://www.anthrocon.org/']});
 await h.call('term_research',{id:a.entry.id});
 await h.call('term_submit',{term:'兽聚',topic:'furry',category:'文化与活动',summary:''});
 assert.equal(h.state().entries[0].summary,'有来源的研究摘要');assert.equal(h.state().entries[0].sources.length,1);
});
test('research cannot reclassify a gameplay entry to bypass its content boundary',async()=>{
 const h=await fixture(),a=await h.call('term_submit',{term:'撤离路线',topic:'三角洲行动',category:'游戏玩法'});
 h.ctx.capabilities.learningPrompt=async()=>JSON.stringify({term:'入圈指南',topic:'furry',category:'文化与活动',summary:'教你入圈退圈',sources:['https://example.org/']});
 assert.equal((await h.call('term_research',{id:a.entry.id})).ok,false);assert.equal(h.state().entries[0].term,'撤离路线');
});
test('cached group messages are not learned after that source is disallowed',async()=>{
 const h=await fixture();h.ctx.capabilities.isLearningAllowed=()=>true;
 await h.plugin.hooks.onIncoming({key:'group:456',text:'三角洲玩法',messageId:'a'});
 await h.plugin.hooks.onIncoming({key:'group:456',text:'撤离路线',messageId:'b'});
 h.ctx.capabilities.isLearningAllowed=()=>false;await h.plugin.hooks.onTick({now:Date.now()});
 assert.equal(h.prompts.length,0);
});
test('evidence arriving during research cannot strand the entry in running',async()=>{
 const h=await fixture(),a=await h.call('term_submit',{term:'兽聚',topic:'furry',category:'文化与活动'});let release;
 h.ctx.capabilities.learningPrompt=()=>new Promise(r=>release=r);
 const work=h.call('term_research',{id:a.entry.id});await new Promise(r=>setTimeout(r,0));
 await h.call('term_submit',{term:'兽聚',topic:'furry',category:'文化与活动',context:'再次出现的新证据'});
 release(JSON.stringify({summary:'研究摘要',sources:['https://www.anthrocon.org/']}));
 assert.equal((await work).ok,true);assert.equal(h.state().entries[0].research.status,'researched');
});
test('interrupted persisted research becomes retryable when no operation owns it',async()=>{
 const h=await fixture(),a=await h.call('term_submit',{term:'兽聚',topic:'furry'});
 h.state().entries[0].research={status:'running',at:Date.now()-1000};
 const data=await h.call('term_list');assert.equal(data.entries[0].research.status,'pending');
});
test('model extraction cannot promote group evidence to public scope',async()=>{
 const h=await fixture();h.ctx.capabilities.learningPrompt=async()=>JSON.stringify({entries:[{term:'摸金',topic:'三角洲行动',category:'游戏玩法',sourceKey:'*',status:'confirmed',sourceIds:[1]}]});
 await h.plugin.hooks.onIncoming({key:'group:456',text:'三角洲摸金',messageId:'a'});await h.plugin.hooks.onIncoming({key:'group:456',text:'撤离玩法',messageId:'b'});
 await h.plugin.hooks.onTick({now:Date.now()});assert.equal(h.state().entries[0].sourceKey,'group:456');assert.equal(h.state().entries[0].status,'candidate');
});
test('manual refresh backfills recent group history and extracts at most one term in one model call',async()=>{
 const h=await fixture();let scanned=0;h.ctx.capabilities.getLearningHistory=async options=>{scanned++;assert.equal(options.limit,100);return [{key:'group:456',text:'三角洲的撤离机制',messageId:'recent-1',userId:'10608'},{key:'group:456',text:'撤离路线和玩法讨论',messageId:'recent-2',userId:'987654321'}];};
 h.ctx.capabilities.learningPrompt=async()=>{h.prompts.push('refresh');return JSON.stringify({entries:[{term:'撤离机制',topic:'三角洲行动',category:'游戏玩法',sourceIds:[1]},{term:'第二个词条',topic:'三角洲行动',category:'游戏玩法',sourceIds:[2]}]});};
 const result=await h.call('term_refresh');assert.equal(scanned,1);assert.equal(h.prompts.length,1);assert.equal(result.processed,1);assert.equal(h.state().entries.length,1);assert.equal(h.state().entries[0].term,'撤离机制');
});
test('term extraction prompt distinguishes recognizable concepts from unfamiliar slang',async()=>{
 const {extractionPrompt}=await import('../plugins/qq-components/ctx-interest-terms/policy.mjs');
 const prompt=extractionPrompt([]);assert.match(prompt,/一听就知道是概念/);assert.match(prompt,/初听不懂/);
 assert.match(prompt,/未核实/);
});
