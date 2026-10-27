import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
const tick = () => new Promise(resolve => setTimeout(resolve,30));

test('a blocked owner send does not block group output; owner order stays serial',async()=>{
  const h=await bridgeHarness(); let release;
  const blocked=new Promise(r=>release=r),sent=[];
  h.bot.sendPrivateMessage=async(_id,text)=>{sent.push(text);if(text==='owner-first')await blocked;};
  h.bot.sendGroupMessage=async(_id,text)=>{sent.push(text);};
  try {
    h.cfg.sendDelayMs=0;
    const first=h.sendToQQ('private:123','owner-first'); await tick();
    const second=h.sendToQQ('private:123','owner-second');
    const group=h.sendToQQ('group:456','group-live'); await tick();
    assert.ok(sent.includes('group-live'),'group must not wait for owner transport');
    assert.ok(!sent.includes('owner-second'),'same conversation must retain order');
    release(); await Promise.all([first,second,group]);
  } finally {release();await h.close();}
});

test('a pending owner inference does not hold the group prompt queue',async()=>{
  const h=await bridgeHarness(); let release;
  const blocked=new Promise(r=>release=r); h.setMode('reserved2');
  h.api.sessions.prompt=async p=>{if(p.content[0].text.includes('OWNER_WORK'))await blocked;h.calls.prompts.push(p);return {result:{ok:true,value:{}}};};
  try {
    const owner=h.deliverPrompt('private:123','OWNER_WORK'); await tick();
    const group=h.deliverPrompt('group:456','GROUP_LIVE'); await tick();
    assert.ok(h.calls.prompts.some(x=>x.content[0].text.includes('GROUP_LIVE')));
    release(); await Promise.all([owner,group]);
  } finally {release();await h.close();}
});

test('owner reply delivery cannot hold group DSH event consumption',async()=>{
  const h=await bridgeHarness();let release,entered;
  const blocked=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  try {
    assert.equal(typeof h.queueDshEnvelope,'function');
    h.setMode('chat');h.cfg.sendDelayMs=0;
    const owner=await h.ensureSession('private:123'),group=await h.ensureSession('group:456');
    h.bot.sendPrivateMessage=async()=>{entered();await blocked;};
    const event=(sid,type,data)=>({payload:{type:'session/event',sessionId:sid,event:{type,data}}});
    await h.queueDshEnvelope(event(owner,'turn/start',{turn:1}));
    await h.queueDshEnvelope(event(owner,'assistant/message',{turn:1,message:{content:[{type:'text',text:'owner-result'}]}}));
    const ownerEnd=h.queueDshEnvelope(event(owner,'turn/end',{turn:1,reason:{kind:'completed'}}));
    await started;
    await h.queueDshEnvelope(event(group,'turn/start',{turn:1}));
    assert.ok(h.v2TurnStartAt.has(group));
    release();await ownerEnd;
  } finally {release();await h.close();}
});

test('offline backlog drains each conversation independently',async()=>{
  const h=await bridgeHarness();let release;
  const blocked=new Promise(r=>release=r);h.setMode('reserved2');h.setReady(false);
  h.api.sessions.prompt=async p=>{if(p.content[0].text.includes('OWNER_BACKLOG'))await blocked;h.calls.prompts.push(p);return {result:{ok:true,value:{}}};};
  try {
    await h.deliverPrompt('private:123','OWNER_BACKLOG');
    await h.deliverPrompt('group:456','GROUP_BACKLOG');
    h.setReady(true);const flushing=h.flushQueue();await tick();
    assert.ok(h.calls.prompts.some(x=>x.content[0].text.includes('GROUP_BACKLOG')),'group backlog must not wait for owner retry');
    release();await flushing;
  } finally {release();await h.close();}
});

test('a stalled independent task admission leaves owner private chat and group chat responsive',async()=>{
 const h=await bridgeHarness({config:{socialV2:{adminDev:{enabled:false},proactive:{enabled:false},curfew:{enabled:false}}}});
 let release,entered;const blocked=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 h.setMode('reserved2');h.setPresets(['standard','qq-chat','qq-chat-v2','qq-task-worker']);
 const token=h.getSocialV2State('private:123').agentToken;
 h.api.sessions.prompt=async p=>{if(p.content[0].text.includes('WORKER_BUSY')){entered();await blocked;}h.calls.prompts.push(p);return {result:{ok:true,value:{}}};};
 let spawning,owner,group;
 try{
  spawning=h.taskCaps.taskSpawn({token,title:'parallel admission',task:'WORKER_BUSY'});await started;
  owner=h.deliverPrompt('private:123','OWNER_CHAT_CONTINUES');group=h.deliverPrompt('group:456','GROUP_CHAT_CONTINUES');await tick();
  assert.ok(h.calls.prompts.some(x=>x.content[0].text.includes('OWNER_CHAT_CONTINUES')),'owner private chat must continue while worker admission waits');
  assert.ok(h.calls.prompts.some(x=>x.content[0].text.includes('GROUP_CHAT_CONTINUES')),'group chat must continue while worker admission waits');
 }finally{release();await Promise.allSettled([spawning,owner,group]);await h.close();}
});
