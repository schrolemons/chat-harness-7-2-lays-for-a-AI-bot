import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/ctx-chat-style/index.js';

const poke=(extra={})=>({kind:'poke',isSelf:false,poke:{targetIsSelf:true},...extra});
function render(unread,extra={}){
 const blocks=[];
 createPlugin({config:{},addPromptBlock:text=>blocks.push(text)}).hooks.beforePrompt({
  reason:'private',roleName:'AI助手',isPrivate:true,isOwnerKey:true,key:'private:10001',
  hasUnreadNow:true,st:{unread},...extra,
 });
 return blocks.join('\n');
}

test('a real poke in an ordinary private batch receives friendly interaction guidance',()=>{
 const text=render([poke(),{kind:'message',text:'在吗'}]);
 assert.match(text,/【拍一拍互动】/);
 assert.match(text,/打招呼|亲近/);assert.match(text,/连续/);
 assert.match(text,/当前形态/);
});

test('critical form keeps its voice while a real poke never defaults to hostility',()=>{
 const text=render([poke()],{moodState:{enabled:true,mode:'critical'}});
 assert.match(text,/【拍一拍互动】/);assert.match(text,/克制/);
 assert.doesNotMatch(text,/诶，我在呀|被你戳到啦/,'concrete voice examples belong to mood settings');
});

test('typed poke text, old history, self pokes and pokes aimed at others do not trigger the rule',()=>{
 for(const rows of [[{kind:'message',text:'[拍一拍] 有人戳了你'}],[poke({isSelf:true})],[poke({poke:{targetIsSelf:false}})],[]])assert.doesNotMatch(render(rows,{st:{unread:rows,recentMessages:[poke()]}}),/【拍一拍互动】/);
 assert.doesNotMatch(render([poke()],{hasUnreadNow:false}),/【拍一拍互动】/);
});

test('group batches and critical discussion routes use the same poke boundary',()=>{
 const text=render([poke()],{reason:'group',isPrivate:false,callService:undefined});
 assert.match(text,/【拍一拍互动】/);
 assert.match(text,/发送计划/);
});
