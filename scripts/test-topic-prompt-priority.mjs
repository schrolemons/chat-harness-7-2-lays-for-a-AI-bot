import test from 'node:test';
import assert from 'node:assert/strict';
import {createTopicActions} from '../plugins/qq-components/ctx-chat-topic-drive/topic-actions.mjs';
import {createPlugin as createWait} from '../plugins/qq-components/life-conversation-wait/index.js';

function fixture(){
 const data={},state={get:()=>data,set:patch=>Object.assign(data,patch)};
 return {data,actions:createTopicActions({state})};
}

test('followup hint prioritizes a concrete sent question before waiting, with an explicit opt-out',()=>{
 const {actions}=fixture();
 const choice=actions.afterWait({key:'private:1',scope:'turn:1',seq:3,emptyWaits:1,endRound:false,random:()=>.1});
 assert.equal(choice.action,'followup');
 assert.match(choice.guidance,/优先.*发送|下一步.*发出/);
 assert.match(choice.guidance,/具体.*问题|具体.*追问/);
 assert.match(choice.guidance,/发送成功.*等待/);
 assert.match(choice.guidance,/不凭空|不.*编造/);
 assert.match(choice.guidance,/允许.*等待|可以.*等待/);
});

test('new topic hint likewise favors a real message instead of an internal plan',()=>{
 const {actions}=fixture();
 const choice=actions.afterWait({key:'group:2',scope:'turn:1',seq:3,emptyWaits:1,endRound:false,random:()=>.6});
 assert.equal(choice.action,'newTopic');
 assert.match(choice.guidance,/优先.*发送|下一步.*发出/);
 assert.match(choice.guidance,/conversationIntent="newTopic"/);
 assert.match(choice.guidance,/不凭空|不.*编造/);
});

test('prompt preference does not block another wait or override finite p/q termination',()=>{
 const {actions}=fixture(),data={};
 const wait=createWait({state:{get:()=>data,set:patch=>Object.assign(data,patch)},config:{endProbabilityPercent:0,probabilityStepPercent:25},callService:(_,method,args)=>actions[method]?.(args)}).services.waitCycle;
 let rolls=[.9,.1];const args={key:'private:1',scope:'turn:1',seq:3,startSeq:3};
 assert.equal(wait.timeout({...args,random:()=>rolls.shift()}).action,'followup');
 const ended=wait.timeout({...args,random:()=>0});
 assert.equal(ended.emptyWaits,2);assert.equal(ended.endRound,true);
 assert.equal(ended.action,'wait');
 assert.equal(ended.actionRequired,undefined);
});
