import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
import{createPlugin}from'../plugins/qq-components/ctx-user-mood/index.js';import{moodPolicy,validateMoodConfig}from'../plugins/qq-components/ctx-user-mood/policy.mjs';
const key='private:123',day=Date.parse('2026-11-12T05:00:00+08:00');
function fixture(seed={}){let state=structuredClone(seed);const plugin=createPlugin({config:{},state:{get:()=>structuredClone(state),set:patch=>{state={...state,...structuredClone(patch)};}}});return {mood:plugin.services.mood,state:()=>state};}
test('current defaults expose a real 60 floor and daily/new-session value 100',()=>{
 const p=moodPolicy();assert.equal(p.minimumScore,60);assert.equal(p.dailyFloor,100);assert.equal(p.initial,100);
 const f=fixture();assert.equal(f.mood.read({key}).score,100);f.mood.initialize({conversations:[{key,score:100}],now:day});
 for(let i=0;i<5;i++)assert(f.mood.adjust({key,action:'dec',value:20,reason:'明确负反馈',now:day+i+1}).ok);
 assert.equal(f.mood.read({key}).score,60);assert.equal(f.state().mood.conversations[key].score,60);
 f.mood.settle({now:day+86400000});assert.equal(f.mood.read({key}).score,100);
});
test('configuring the floor corrects a legacy zero without deleting or rewriting its negative evidence',()=>{
 const history=[{at:day,source:'model-adjustment',action:'dec',value:60,reason:'原负面反馈',before:60,after:0,delta:-60}];
 const f=fixture({mood:{conversations:{[key]:{score:0,baseScore:60,history}},waits:{},incoming:{},deliveries:{}}});
 assert.equal(f.state().mood.conversations[key].score,60);const events=f.state().mood.conversations[key].history;
 assert.equal(events[0].reason,'原负面反馈');assert.equal(events[0].after,0);assert.equal(events[1].source,'policy-floor');assert.equal(events[1].minimumScore,60);
 f.mood.enforceMinimum();assert.equal(f.state().mood.conversations[key].history.length,2);
});
test('unanswered episodes also stop at the configured floor',()=>{
 const f=fixture();f.mood.initialize({conversations:[{key,score:60}],now:day});
 f.mood.sent({key,deliveryId:'one',proactiveId:'one',wakeReason:'proactiveCheck',sentAt:day,success:true,expectsReply:true});
 f.mood.settle({now:day+21*60000});assert.equal(f.state().mood.conversations[key].score,60);assert(f.mood.history({key}).items.some(x=>x.source==='unanswered'));
});
test('Console schema and controls expose the floor, reject invalid or contradictory values',()=>{
 const rules={positiveRules:[],negativeRules:[]};assert.equal(validateMoodConfig({...rules,minimumScore:60,dailyFloor:100}).ok,true);assert.equal(validateMoodConfig({...rules,minimumScore:101}).ok,false);assert.equal(validateMoodConfig({...rules,minimumScore:60,dailyFloor:40}).ok,false);
 const schema=JSON.parse(fs.readFileSync(new URL('../plugins/qq-components/ctx-user-mood/plugin.json',import.meta.url)));assert.equal(schema.config.minimumScore,60);assert.equal(schema.config.dailyFloor,100);
 const ui=fs.readFileSync(new URL('../console/layers/C/components/ctx-user-mood.js',import.meta.url),'utf8');assert.match(ui,/key:'minimumScore'/);assert.match(ui,/每日恢复值（默认100）/);
});
