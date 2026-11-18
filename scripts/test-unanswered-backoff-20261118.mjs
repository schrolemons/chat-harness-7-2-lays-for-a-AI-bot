import test from 'node:test';import assert from 'node:assert/strict';import {createProactive} from '../plugins/qq-components/life-wake-reasons/proactive.mjs';
function fixture(){let data={};const calls=[];const proactive=createProactive({config:{curfewEnabled:false,unansweredAfterMinutes:20,unansweredStepMinutes:60,unansweredPenalty:15,minimumWillingness:1},state:{get:()=>data,set:p=>Object.assign(data,p)},scheduler:{cancel(){},schedule:p=>{calls.push(p);return p;}},capabilities:{getProactiveFacts:()=>({transportReady:true,busy:false}),requestProactiveWake:()=>true}});return {proactive,calls,state:()=>data};}
const key='private:123',start=1_000_000;
test('long unanswered contact reduces willingness on its own clock without changing a mood ledger',()=>{
 const f=fixture();f.proactive.observe({key,kind:'sent',isProactive:true,reason:'proactiveCheck',episodeId:'one',eventId:'s1',at:start,success:true});assert.equal(f.proactive.availability({key,now:start+19*60000}).willingness,60);assert.equal(f.proactive.availability({key,now:start+20*60000}).willingness,45);assert.equal(f.proactive.availability({key,now:start+80*60000}).willingness,30);assert.equal(f.state().mood,undefined);
});
test('own messages and AI neutral reassessments do not reset the unanswered episode',()=>{
 const f=fixture();f.proactive.observe({key,kind:'sent',isProactive:true,reason:'proactiveCheck',episodeId:'one',eventId:'s1',at:start,success:true});f.proactive.observe({key,kind:'sent',isProactive:true,reason:'proactiveCheck',episodeId:'two',eventId:'s2',at:start+30*60000,success:true});f.proactive.setWillingness({key,value:60,reason:'无新增忙闲依据，保持中性',now:start+40*60000});assert.equal(f.proactive.availability({key,now:start+80*60000}).willingness,30);
});
test('three unanswered contacts remain probability-controlled and long silence keeps a positive floor',()=>{
 const f=fixture();for(let i=0;i<3;i++)f.proactive.observe({key,kind:'sent',isProactive:true,reason:'proactiveCheck',episodeId:'e'+i,eventId:'s'+i,at:start+i*30*60000,success:true});assert.equal(f.proactive.plan({key,now:start+300*60000,facts:{allowed:true,budgetAllowed:true,transportReady:true,busy:false},random:()=>0}).allowed,true);assert.equal(f.proactive.allowsReason({key,reason:'timeBubble',now:start+300*60000}).allowed,true);assert.equal(f.proactive.availability({key,now:start+300*60000}).willingness,1);
});
test('real new private input reopens contact, but mechanical notices neither count nor reopen it',()=>{
 const f=fixture();for(let i=0;i<3;i++)f.proactive.observe({key,kind:'sent',isProactive:true,reason:'proactiveCheck',episodeId:'e'+i,eventId:'s'+i,at:start+i*60000,success:true});f.proactive.observe({key,kind:'sent',isProactive:true,reason:'thinkingAck',eventId:'mechanical',at:start+90*60000,success:true});assert(f.proactive.availability({key,now:start+90*60000}).willingness<60);f.proactive.observe({key,kind:'incoming',hasText:true,eventId:'human',at:start+100*60000});assert.equal(f.proactive.availability({key,now:start+100*60000}).willingness,60);
});

test('multipart contact counts once and unrelated group speech does not reset the unanswered episode',()=>{
 const f=fixture(),key='group:456';for(let i=0;i<2;i++)f.proactive.observe({key,kind:'sent',isProactive:true,reason:'proactiveCheck',episodeId:'same',eventId:'s'+i,at:start+i,success:true});
 f.proactive.observe({key,kind:'incoming',hasText:true,directedAtBot:false,eventId:'other-human',at:start+60000});
 const a=f.proactive.availability({key,now:start+21*60000});assert.equal(a.unansweredAttempts,1);assert.equal(a.willingness,45);
 f.proactive.observe({key,kind:'incoming',hasText:true,directedAtBot:true,eventId:'direct-human',at:start+22*60000});assert.equal(f.proactive.availability({key,now:start+22*60000}).willingness,60);
});
