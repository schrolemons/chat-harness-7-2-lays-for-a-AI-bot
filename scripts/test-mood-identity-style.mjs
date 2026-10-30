import test from 'node:test';import assert from 'node:assert/strict';
import {moodPolicy,moodSnapshot} from '../plugins/qq-components/ctx-user-mood/policy.mjs';
import {createPlugin as dynamics} from '../plugins/qq-components/ctx-context-dynamics/index.js';
import {createPlugin as style} from '../plugins/qq-components/ctx-chat-style/index.js';
const collect=(factory,payload)=>{const blocks=[];factory({config:{},addPromptBlock:t=>blocks.push(t)}).hooks.beforePrompt(payload);return blocks.join('\n');};
test('long form examples survive policy normalization and active-form selection',()=>{
 const normal='普通说明'.repeat(180)+'\n用户：回来了\n角色：我在等你分享刚才的事。END-NORMAL';
 const critical='临界说明'.repeat(180)+'\n用户：你在吗\n角色：在。刚才那个问题，我还没有想明白。END-CRITICAL';
 const p=moodPolicy({normalStyle:normal,criticalStyle:critical});
 for(const [score,end,other] of [[60,'END-NORMAL','END-CRITICAL'],[10,'END-CRITICAL','END-NORMAL']]){
  const s=moodSnapshot({score},p);assert.ok(s.styleInstruction.includes(end));assert.ok(!s.styleInstruction.includes(other));
  assert.ok(collect(dynamics,{key:'private:1',moodState:s,stickerConfig:{enabled:false}}).includes(end));
 }
});
test('configured normal form has no second hardcoded cute voice',()=>{
 const s=moodSnapshot({score:80},moodPolicy({normalStyle:'平静自然，不使用结巴'}));
 const text=collect(style,{key:'private:1',roleName:'小鲸鱼',isPrivate:true,incomingText:'你好',moodState:s});
 assert.doesNotMatch(text,/软乎乎|那那那|先带一点得意|鲸鱼式想象/);
});
test('care topics keep selected identity even when sticker and optional style are suppressed',()=>{
 const s=moodSnapshot({score:20},moodPolicy({criticalStyle:'CUSTOM-CRITICAL'}));
 const text=collect(dynamics,{key:'private:1',roleName:'小鲸鱼',incomingText:'我很难过，先陪我说说',moodState:s,stickerConfig:{enabled:false}});
 assert.match(text,/CUSTOM-CRITICAL/);
});

test('form text beyond the documented limit is rejected instead of silently clipped',async()=>{
 const {validateMoodConfig}=await import('../plugins/qq-components/ctx-user-mood/policy.mjs');
 assert.equal(validateMoodConfig({positiveRules:[],negativeRules:[],normalStyle:'a'.repeat(2401)}).ok,false);
});

test('host defaults put selected identity first and preserve the end of long examples',async()=>{
 const {createPluginHost}=await import('../src/plugin-host.js');
 const host=createPluginHost({root:process.cwd(),startTimers:false});
 try{
  await host.loadAll();
  const normal='日常描述'.repeat(310)+'END-HOST-NORMAL',critical='安静描述'.repeat(310)+'END-HOST-CRITICAL';
  for(const score of [60,20]){
   const moodState=moodSnapshot({score},moodPolicy({normalStyle:normal,criticalStyle:critical}));
   const blocks=host.collectPromptBlocks({key:'private:20018',roleName:'小鲸鱼',incomingText:'你好',isPrivate:true,moodState,stickerConfig:{enabled:false}});
   assert.ok(blocks[0].startsWith('【当前形态】'));
   const text=blocks.join('\n');assert.equal(text.split(score===60?'END-HOST-NORMAL':'END-HOST-CRITICAL').length-1,1);
   assert.ok(!text.includes(score===60?'END-HOST-CRITICAL':'END-HOST-NORMAL'));
   assert.doesNotMatch(text,/软乎乎|那那那/);
  }
 }finally{await host.dispose();}
});
