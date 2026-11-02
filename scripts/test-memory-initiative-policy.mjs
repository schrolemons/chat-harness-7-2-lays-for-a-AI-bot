import test from 'node:test';import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/ctx-memory-profile-facts/index.js';
import {createPlugin as createUpdate} from '../plugins/qq-components/ctx-memory-update/index.js';

function render(key,reason){
 const userId=key.startsWith('private:')?key.slice(8):'12345',message={userId,sender:'用户',text:'我每周五下午有固定训练；下周报告还要改，别让我忘记提交',messageId:'real-evidence',time:Date.now(),seq:1},blocks=[];let state={};
 const plugin=createPlugin({config:{},state:{get:()=>state,set:patch=>state={...state,...patch}},addPromptBlock:text=>blocks.push(text)});
 plugin.hooks.onIncoming({...message,key,at:message.time});
 const tail=plugin.hooks.beforePrompt({key,reason,admittedMessages:[message],st:{recentMessages:[message]}});
 return {blocks,prompt:[...blocks,tail].join('\n')};
}

for(const key of ['private:12345','group:45678'])for(const reason of ['message','memoryWrite'])test(key+' '+reason+': available evidence leads to write-and-confirm instructions, not read-only maintenance',()=>{
 const {prompt}=render(key,reason);
 for(const required of ['主动维护闭环','profile_update','qq_task_note','qq_schedule','time_bubble_manage','查询不等于完成','不必等用户说','缺少关键条件','工具确认成功'])assert(prompt.includes(required),required);
 assert.match(prompt,/real-evidence/);assert.match(prompt,/私聊和群聊/);
});

test('initiative retains privacy, scheduling consent, quiet hours, budgets and no-extra-model-turn rules',()=>{
 const {prompt}=render('private:12345','message');
 for(const required of ['不扩大读写权限','明确提醒意图','免打扰','锁定','现有限额','不增加独立模型回合','没有新增信息不重复调用','memoryWrite 不发 QQ'])assert(prompt.includes(required),required);
});

test('maintenance gets one copy of the shared initiative policy even when candidate extraction already supplied it',()=>{
 const {blocks}=render('private:12345','memoryWrite');
 const tail=createUpdate({config:{}}).hooks.beforePrompt({key:'private:12345',reason:'memoryWrite',priorPromptModules:[{id:'ctx-memory-profile-facts',text:blocks.join('\n')}],st:{}});
 const joined=blocks.join('\n')+'\n'+tail;
 assert.equal(joined.split('【主动维护闭环】').length-1,1);
 assert.match(tail,/不要发任何 QQ 消息/);
});
