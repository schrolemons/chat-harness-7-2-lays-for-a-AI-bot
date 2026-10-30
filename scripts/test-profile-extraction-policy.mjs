import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin } from '../plugins/qq-components/ctx-memory-profile-facts/index.js';
import { createPlugin as memoryUpdate } from '../plugins/qq-components/ctx-memory-update/index.js';
function fixture(config={}) { let state={}; const p=createPlugin({config,state:{get:()=>state,set:x=>state={...state,...x}}});return {p,get:()=>state}; }
test('memory refresh recovers same-session raw evidence with identity and message provenance',()=>{
 const {p}=fixture(); const prompt=p.hooks.beforePrompt({key:'private:10001',reason:'memoryWrite',st:{recentMessages:[{userId:'10001',sender:'甲',text:'我和乙一起吃过饭',seq:7,messageId:'90071992547409931234',time:20009,isSelf:false},{userId:'10001',text:'bot不能成为证据',isSelf:true}]}});
 assert.match(prompt,/我和乙一起吃过饭/);assert.match(prompt,/90071992547409931234/);assert.match(prompt,/20009/);assert.doesNotMatch(prompt,/bot不能成为证据/);
});
test('rendering candidates does not consume evidence before any confirmed profile write',()=>{
 const {p,get}=fixture();p.hooks.onIncoming({key:'private:10001',userId:'10001',text:'我平时喜欢游泳',messageId:'m1'});p.hooks.beforePrompt({key:'private:10001',reason:'message'});assert.equal(get().pending.length,1);assert.match(p.hooks.beforePrompt({key:'private:10001',reason:'memoryWrite'}),/游泳/);
});
test('same transport event is retained once and unknown or mismatched identities are not admitted',()=>{
 const {p,get}=fixture();const msg={key:'private:10001',userId:'10001',text:'我喜欢摄影',messageId:'m1'};p.hooks.onIncoming(msg);p.hooks.onIncoming(msg);p.hooks.onIncoming({...msg,userId:'10002',messageId:'m2'});p.hooks.onIncoming({...msg,userId:undefined,messageId:'m3'});p.hooks.onIncoming({...msg,isSelf:true,messageId:'m4'});assert.equal(get().pending.length,1);
});
test('memory refresh bypasses ordinary cooldown but excludes private material from other sessions',()=>{
 const {p}=fixture({cooldownMs:600000});p.hooks.onIncoming({key:'private:10001',userId:'10001',text:'我喜欢摄影'});p.hooks.onIncoming({key:'private:10002',userId:'10002',text:'其他私聊保密资料'});p.hooks.beforePrompt({key:'private:10001',reason:'message'});const s=p.hooks.beforePrompt({key:'private:10001',reason:'memoryWrite'});assert.match(s,/摄影/);assert.doesNotMatch(s,/其他私聊保密资料/);assert.equal(p.hooks.beforePrompt({reason:'memoryWrite'}),'');assert.equal(p.hooks.beforePrompt({key:'private:10001',reason:'userFeedbackReview'}),'');
});
test('truncated snippets are marked rather than presented as complete evidence',()=>{
 const {p,get}=fixture({maxCharsPerSnippet:8});p.hooks.onIncoming({key:'private:10001',userId:'10001',text:'我说的关系内容在这里后面还有否定语句'});assert.equal(get().pending[0].truncated,true);assert.match(p.hooks.beforePrompt({key:'private:10001',reason:'memoryWrite'}),/截断/);
});
test('scheduled memory refresh requires supplementing all profile fields before MD output',()=>{
 const s=memoryUpdate({config:{}}).hooks.beforePrompt({key:'private:10001',reason:'memoryWrite'});for(const x of ['profile_get','profile_update','routine_food','hobbies','relationships','catchphrases','来源','共同用餐','转述','合并','成功','【未完成事项】'])assert.ok(s.includes(x),x);assert.match(s,/不.*(?:推断|臆测)/);assert.match(s,/不要发任何 QQ 消息/);
});
