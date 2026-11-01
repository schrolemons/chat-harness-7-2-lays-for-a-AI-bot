import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {createMilkMonitor} from '../plugins/qq-components/tool-deepseek-balance/monitor.mjs';
import {createPlugin as createSessionFacts} from '../plugins/qq-components/ctx-context-session/index.js';

test('scheduled milk changes do not bypass hard model budget with a mechanical notification',async()=>{
 const h=await bridgeHarness({config:{sendDelayMs:0},files:{'state/plugins/config/life-token-budget.json':{ownerBudgetEnabled:true,globalHardLimitYuan:.1},'state/plugins/config/ctx-chat-reply-shape.json':{intervalMinMs:0,intervalMaxMs:0,longGapProbability:0,maxSendPerMinute:100,maxSendPerHour:100}}});
 try{
  h.setMode('reserved2');const key='private:123',sessionId=await h.ensureSession(key);
  h.tokenLedger.ingestEvent({sessionId,at:Date.now()-10,model:'deepseek-flash',event:{type:'assistant/message',seq:1,data:{turn:1,step:1,usage:{inputTokens:1000000,outputTokens:100}}}});
  assert.equal(h.tokenBudgetOf(key).stage,'silent');
  let state={},now=Date.now(),amount='10.00';
  const monitor=createMilkMonitor({config:{},capabilities:h.taskCaps,state:{get:()=>state,set:p=>state={...state,...p}}},{clock:()=>now,query:async()=>({ok:true,is_available:amount!=='0.00',balance_infos:[{currency:'CNY',total_balance:amount,granted_balance:'0',topped_up_balance:amount}]})});
  await monitor.tick();assert.equal(h.calls.sent.length,0);
  for(const next of ['4.50','0.50','0.00','12.00']){amount=next;now+=5*60000;await monitor.tick();}
  assert.equal(h.calls.sent.length,0,'scheduled conversation never falls back to unmetered mechanical QQ sends');
  assert.equal(h.calls.prompts.length,0,'milk notifications cannot create a model round at hard budget');
  await monitor.tick();assert.equal(h.calls.sent.length,0,'unchanged stock must not replay a notification');
  const render=target=>{const blocks=[];createSessionFacts({config:{},addPromptBlock:s=>blocks.push(s),callService:(service,method,payload)=>service==='milkStock'?monitor[method](payload):null}).hooks.beforePrompt({key:target,st:{unread:[],recentMessages:[]}});return blocks.join('\n');};
  assert.match(render(key),/CNY 12.00/);assert.match(render('group:456'),/API预算/);assert.match(render('private:124'),/API预算/);assert.doesNotMatch(render('group:456'),/CNY 12.00/);assert.doesNotMatch(render('private:124'),/CNY 12.00/);
 }finally{await h.close();}
});
