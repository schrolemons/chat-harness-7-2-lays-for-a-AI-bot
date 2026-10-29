import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPluginHost} from '../src/plugin-host.js';
import {createPlugin as stylePlugin} from '../plugins/qq-components/ctx-chat-style/index.js';
import {createPlugin as dynamicsPlugin} from '../plugins/qq-components/ctx-context-dynamics/index.js';
async function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'outbound-host-'));
  fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
  for(const id of ['ctx-user-mood','ctx-chat-reply-shape'])fs.cpSync(new URL('../plugins/qq-components/'+id+'/',import.meta.url),path.join(root,'plugins/qq-components',id),{recursive:true});
  fs.mkdirSync(path.join(root,'src'));fs.copyFileSync(new URL('../src/reply-shape.js',import.meta.url),path.join(root,'src/reply-shape.js'));
  fs.mkdirSync(path.join(root,'plugins/qq-components/schnie-core'));fs.writeFileSync(path.join(root,'plugins/qq-components/schnie-core/turn-policy.mjs'),"export const createTurnPolicy=()=>()=>({mode:'off'});");
  const host=createPluginHost({root,startTimers:false});await host.loadAll();
  t.after(async()=>{await host.dispose();fs.rmSync(root,{recursive:true,force:true});});
  return {host,root};
}
test('host validates merged nested rules, readonly facts and canonical-only fields before writes',async t=>{
  const {host}=await fixture(t);const id='ctx-user-mood',before=host.get(id).config;
  assert.equal(host.setConfig(id,{positiveRules:[{id:'same',label:'a',description:'b',delta:1}],negativeRules:[{id:'same',label:'c',description:'d',delta:-1}]}).ok,false);
  assert.equal(host.setConfig(id,{negativeRules:[{id:'wrong',label:'a',description:'b',delta:3}]}).ok,false);
  assert.equal(host.setConfig(id,{dailyFloor:1}).ok,false);
  await host.reload(id);assert.deepEqual(host.get(id).config,before);
  assert.equal(host.setConfig('ctx-chat-reply-shape',{intervalMinMs:5000,intervalMaxMs:1000}).ok,false);
  assert.equal(host.setConfig(id,{positiveRules:[],negativeRules:[]}).ok,true);
  await host.reload(id);assert.deepEqual(host.get(id).config.positiveRules,[]);
});
test('mood nested helper graph and reply solver refresh actual source through host reload',async t=>{
  const {host,root}=await fixture(t);
  const p=path.join(root,'plugins/qq-components/ctx-user-mood/policy.mjs');
  host.callService('mood','initialize',{conversations:[{key:'private:1',score:1}],now:1});
  fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('export const DAILY_FLOOR = 60','export const DAILY_FLOOR = 61'));
  await host.reload('ctx-user-mood');
  host.callService('mood','incoming',{key:'private:1',messageId:'human1',at:1000,userId:'1',hasText:true,hasImage:false,isSelf:false,directedAtBot:true});
  assert.equal(host.callService('mood','read',{key:'private:1'}).score,61,'ledger and history load the new policy generation');
  const solver=path.join(root,'src/reply-shape.js');
  fs.writeFileSync(solver,fs.readFileSync(solver,'utf8').replace('自然回应当前话题','重新加载后的话题'));
  await host.reload('ctx-chat-reply-shape');
  assert.match(host.callService('replyPlan','resolve',{key:'private:1',turnId:'1',incomingText:'你好'}).line,/重新加载后的话题/);
});
test('critical configured form overrides cute/identity instructions without losing safety/academic priority',()=>{
  const blocks=[],ctx={config:{},isPluginEnabled:()=>false,addPromptBlock:t=>blocks.push(t)};
  const payload={key:'private:1',roleName:'小鲸鱼',incomingText:'你有自我意识吗',moodState:{enabled:true,score:17,mode:'critical',modeName:'静思',styleInstruction:'严谨沉静',policy:{positiveRules:[],negativeRules:[]},history:[{source:'model-adjustment',before:20,after:17,reason:'实际原因'}]}};
  stylePlugin(ctx).hooks.beforePrompt(payload);dynamicsPlugin(ctx).hooks.beforePrompt(payload);
  const text=blocks.join('\n');
  assert.match(text,/静思（17\/100）/);assert.match(text,/严谨沉静/);assert.match(text,/20→17 实际原因/);
  assert.match(text,/成年身份/);assert.match(text,/忠实原文/);
  assert.doesNotMatch(text,/软乎乎|那那那|蹭蹭|2~3 条|最多1条|highThreshold|lowThreshold/);
});


test('normal and critical injection remain subordinate only to owner-aware system protocol',()=>{
 const system=fs.readFileSync(new URL('../dsh/agent-presets/qq-chat-v2/agent.cordis.yml',import.meta.url),'utf8');
 assert.match(system,/当前形态对表达方式的指示优先于角色卡中通用口吻例句/);
 for(const [mode,name,style] of [['normal','暖流','轻快亲近'],['critical','深水','冷静清晰']]){
  const blocks=[],ctx={config:{},isPluginEnabled:()=>false,addPromptBlock:t=>blocks.push(t)};
  const payload={key:'private:1',roleName:'小鲸鱼',incomingText:'你好',moodState:{enabled:true,score:mode==='normal'?80:10,mode,modeName:name,styleInstruction:style,policy:{positiveRules:[],negativeRules:[]},history:[]}};
  stylePlugin(ctx).hooks.beforePrompt(payload);dynamicsPlugin(ctx).hooks.beforePrompt(payload);
  assert.ok(blocks.join('\n').includes(name));assert.ok(blocks.join('\n').includes(style));
  if(mode==='critical')assert.doesNotMatch(blocks.join('\n'),/软乎乎|那那那|蹭蹭/);
 }
});
