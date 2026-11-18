import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/ctx-context-dynamics/index.js';
import {createOutboundTransport} from '../src/outbound-context.js';
const expression=()=>createPlugin({config:{},capabilities:{}}).services.chatExpression;
test('repeated long chat is blocked across new rounds while short answers, other chats and old messages remain valid',()=>{
 const p=createPlugin({config:{},capabilities:{},addPromptBlock(){}}),text='唔……AI助手醒啦，刚浮到水面还懵懵的，伸了个软软的懒腰。';
 p.hooks.beforePrompt({key:'group:456',recentOwnMessages:[{isSelf:true,time:Date.now()-60000,text}]});
 assert.equal(p.services.chatExpression.validate({key:'group:456',kind:'text',text}).reason,'repeated_chat_body');
 assert.equal(p.services.chatExpression.validate({key:'group:789',kind:'text',text}).ok,true);
 assert.equal(p.services.chatExpression.validate({key:'group:456',kind:'text',text:'在呢'}).ok,true);
 p.hooks.beforePrompt({key:'group:456',recentOwnMessages:[{isSelf:true,time:Date.now()-16*60000,text}]});
 assert.equal(p.services.chatExpression.validate({key:'group:456',kind:'text',text}).ok,true);
});
test('QQ receipt prefixes are rejected before sending ordinary text',()=>{
 const service=expression();
 for(const text of ['【QQ#2280.1】你好呀','你好\n【QQ#42.2】预算池偏少','  【QQ#7】收到啦']){
  const result=service.validate({key:'group:456',kind:'text',text});
  assert.equal(result.ok,false);assert.equal(result.reason,'internal_receipt_marker');
 }
});
test('ordinary messages and discussion of a receipt marker remain valid',()=>{
 const service=expression();
 for(const text of ['用户，预算池有点浅啦。','这个编号【QQ#2280.1】是错误示例。','第2280.1项还没完成'])
  assert.equal(service.validate({key:'private:123',kind:'text',text}).ok,true);
});
test('the physical transport never sends an internal receipt prefix',async()=>{
 let sends=0;const service=expression(),key='group:456';
 const transport=createOutboundTransport({callService:(name,method,payload)=>name==='chatExpression'?service[method](payload):undefined});
 const context={key,sourceKey:key,agent:true,reason:'message',envelope:{reason:'message'},plan:{scheduledGrant:{ids:['isolated-fixture']},maxMessageChars:600}};
 await assert.rejects(transport.perform({key,context,text:'【QQ#2280.1】预算池有点浅',send:async()=>{sends++;}}),/internal_receipt_marker/);
 assert.equal(sends,0);
});
