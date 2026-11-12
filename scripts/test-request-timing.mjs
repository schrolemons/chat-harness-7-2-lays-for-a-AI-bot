import test from 'node:test';import assert from 'node:assert/strict';
import {summarizeRequestTiming} from '../src/diagnostics/request-timing.mjs';
test('unchanged headers cannot hide a third model request as framework overhead',()=>{
 const events=[['turn/start',10],['step/start',15],['request/header',20],['assistant/message',120],['tool/call',121,'a'],['tool/result',125,'a'],['step/start',130],['request/header',135],['assistant/message',235],['tool/call',236,'b'],['tool/result',240,'b'],['step/start',245],['assistant/message',345],['turn/end',350]].map(([type,at,callId])=>({type,at,callId}));
 const r=summarizeRequestTiming(events,{started:0,finished:355});assert.equal(r.requests.length,3);assert.equal(r.requestMs,300);assert.equal(r.requests[2].includesPreparation,true);assert.equal(r.toolMs,8);assert.equal(r.otherNativeMs,32);assert.equal(r.entryMs+r.requestMs+r.toolMs+r.otherNativeMs+r.deliveryMs,355);
});
test('parallel tool intervals are counted once and do not inflate total latency',()=>{
 const events=[{type:'turn/start',at:0},{type:'step/start',at:0},{type:'assistant/message',at:10},{type:'tool/call',at:10,callId:'a'},{type:'tool/call',at:12,callId:'b'},{type:'tool/result',at:20,callId:'a'},{type:'tool/result',at:25,callId:'b'},{type:'turn/end',at:30}];
 assert.equal(summarizeRequestTiming(events,{started:0,finished:30}).toolMs,15);
});
