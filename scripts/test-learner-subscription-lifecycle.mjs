import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {NodeApiClient} from '../src/dsh-client.js';

// Real bridge learner admission + real client's desired-subscription ownership.
// The fixture has no socket, DSH/QQ process, real history, or model connection.
for(const started of [false,true])test(`failed learner prompt releases its retired subscription (turn started: ${started})`,async()=>{
  const h=await bridgeHarness({config:{slang:{enabled:true,learnerPreset:'qq-learning'}}});
  h.setMode('reserved2');h.setReady(true);h.setPresets(['standard','qq-chat','qq-chat-v2','qq-learning']);
  const client=new NodeApiClient('http://127.0.0.1:1',1000,{});
  h.api.events.follow=client.events.follow;h.api.events.forget=client.events.forget;
  h.api.sessions.prompt=async payload=>{
    if(started)await h.queueDshEnvelope({payload:{type:'session/event',sessionId:payload.sessionId,event:{type:'turn/start',data:{turn:1}}}});
    throw Error('synthetic learner prompt failure');
  };
  try{
    await assert.rejects(h.taskCaps.learningPrompt('synthetic learning fixture',{key:'*'}),/synthetic learner prompt failure/);
    assert.equal(h.calls.created.length,1);
    if(started){
      assert.equal(client._desiredFollows.has('fixture-1'),true,'an observed running turn survives an RPC acknowledgement failure');
      await h.queueDshEnvelope({payload:{type:'session/event',sessionId:'fixture-1',event:{type:'turn/end',data:{turn:1,reason:{kind:'cancelled'}}}}});
    }
    assert.deepEqual([...client._desiredFollows],[], 'retired learner must not be replayed on the next connection');
  }finally{await h.close();}
});

test('successful current learner keeps its subscription and is reused',async()=>{
  const h=await bridgeHarness({config:{slang:{enabled:true,learnerPreset:'qq-learning'}}});
  h.setMode('reserved2');h.setPresets(['standard','qq-chat','qq-chat-v2','qq-learning']);
  const client=new NodeApiClient('http://127.0.0.1:1',1000,{});h.api.events.follow=client.events.follow;h.api.events.forget=client.events.forget;
  let turn=0;
  h.api.sessions.prompt=async({sessionId})=>{
    turn++;
    for(const [type,data] of [['turn/start',{turn}],['assistant/message',{turn,message:{content:[{type:'text',text:'synthetic result'}]}}],['turn/end',{turn,reason:{kind:'completed'}}]])
      await h.queueDshEnvelope({payload:{type:'session/event',sessionId,event:{type,data}}});
    return {result:{ok:true,value:{}}};
  };
  try{
    assert.equal(await h.taskCaps.learningPrompt('first',{key:'*'}),'synthetic result');
    assert.equal(await h.taskCaps.learningPrompt('second',{key:'*'}),'synthetic result');
    assert.equal(h.calls.created.length,1);assert.deepEqual([...client._desiredFollows],['fixture-1']);
  }finally{await h.close();}
});

for(const owner of ['mapped','task'])test(`retiring the learner must preserve a shared ${owner} subscription`,async()=>{
  const h=await bridgeHarness({config:{slang:{enabled:true,learnerPreset:'qq-learning'}},
    ...(owner==='mapped'?{savedState:{sessions:{'private:123':'fixture-1'}}}:{files:{'state/tasks.json':{tasks:{'task-fixture':{id:'task-fixture',originKey:'private:123',sessionId:'fixture-1',status:'running'}}}}})});
  h.setMode('reserved2');h.setPresets(['standard','qq-chat','qq-chat-v2','qq-learning']);
  const client=new NodeApiClient('http://127.0.0.1:1',1000,{});h.api.events.follow=client.events.follow;h.api.events.forget=client.events.forget;
  h.api.sessions.prompt=async()=>{throw Error('synthetic learner prompt failure');};
  try{await assert.rejects(h.taskCaps.learningPrompt('fixture',{key:'*'}),/synthetic/);assert.deepEqual([...client._desiredFollows],['fixture-1']);}
  finally{await h.close();}
});

for(const outcome of ['completed','cancelled','prompt-rejected'])test(`retired learner keeps pending ownership until ${outcome} and then releases`,async()=>{
  const h=await bridgeHarness({config:{slang:{enabled:true,learnerPreset:'qq-learning'}}});
  h.setMode('reserved2');h.setPresets(['standard','qq-chat','qq-chat-v2','qq-learning']);
  const client=new NodeApiClient('http://127.0.0.1:1',1000,{});h.api.events.follow=client.events.follow;h.api.events.forget=client.events.forget;
  let entered,rejectPrompt;const started=new Promise(resolve=>entered=resolve);
  h.api.sessions.prompt=async({sessionId})=>{
    if(outcome!=='prompt-rejected')await h.queueDshEnvelope({payload:{type:'session/event',sessionId,event:{type:'turn/start',data:{turn:1}}}});
    entered(sessionId);
    return outcome==='prompt-rejected'?new Promise((_resolve,reject)=>rejectPrompt=reject):{result:{ok:true,value:{}}};
  };
  const work=h.taskCaps.learningPrompt('synthetic active learner',{key:'*'});work.catch(()=>{});
  const sessionId=await started,server=h.startConsoleServer();if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/slang/config`,{method:'POST',headers:{'x-console-token':'fixture-console-token','content-type':'application/json'},body:JSON.stringify({learnerPreset:'qq-chat'})});
    assert.equal(response.status,200);assert.equal(client._desiredFollows.has(sessionId),true,'pending waiters/observed turn must retain their stream');
    if(outcome==='prompt-rejected')rejectPrompt(Error('synthetic post-retirement rejection'));
    else{
      await h.queueDshEnvelope({payload:{type:'session/event',sessionId,event:{type:'assistant/message',data:{turn:1,message:{content:[{type:'text',text:'synthetic result'}]}}}}});
      await h.queueDshEnvelope({payload:{type:'session/event',sessionId,event:{type:'turn/end',data:{turn:1,reason:{kind:outcome}}}}});
    }
    if(outcome==='completed')assert.equal(await work,'synthetic result');else await assert.rejects(work);
    assert.deepEqual([...client._desiredFollows],[]);
  }finally{await new Promise(resolve=>server.close(resolve));await h.close();}
});
