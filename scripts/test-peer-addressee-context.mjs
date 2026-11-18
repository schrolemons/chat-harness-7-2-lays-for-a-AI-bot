import test from'node:test';import assert from'node:assert/strict';import{createAddresseeContext,ADDRESSEE_RULE}from'../plugins/qq-components/ctx-context-session/addressees.mjs';import{createPlugin}from'../plugins/qq-components/ctx-context-session/index.js';
const row=(seq,text)=>({seq,messageId:'m'+seq,userId:'111',time:1000,text,plain:text});
const at=qq=>({type:'at',data:{qq}}),text=s=>({type:'text',data:{text:s}});
const event=(id,message,extra={})=>({message_id:id,user_id:111,self_id:999,group_id:456,message_type:'group',message,...extra});
const base={key:'group:456',selfId:'999'};
test('the owner of the mentioned bot is the actor, not the bot or the @recipient as an object',()=>{
 const render=createAddresseeContext(()=>({ok:true,messages:[event('m1',[at('222'),text('你调教一下你的肥鱼')])]}));
 const result=render({...base,admittedMessages:[row(1,'@群友 你调教一下你的肥鱼')]});
 const fact=JSON.parse(result.split('\n')[1])[0];assert.deepEqual(fact,{seq:1,speakerId:'111',mentionedUserIds:['222'],leadingMentionUserIds:['222'],addressedToBot:false});assert(ADDRESSEE_RULE.includes('不是让bot调教被@的人'));
});
test('an old @bot in the quoted body does not replace the current top-level addressee',()=>{
 const render=createAddresseeContext(()=>({ok:true,messages:[event('m2',[{type:'reply',data:{id:'old'}},at('222'),text('你去把他的白饭锁起来')])]}));
 const r=row(2,'@群友 你去把他的白饭锁起来');r.text='[引用 @AI助手 先安静一会]'+r.plain;
 const fact=JSON.parse(render({...base,admittedMessages:[r]}).split('\n')[1])[0];assert.deepEqual(fact.mentionedUserIds,['222']);assert.equal(fact.addressedToBot,false);assert.equal(fact.currentBody,'@QQ:222你去把他的白饭锁起来');assert(!fact.currentBody.includes('先安静'));
 const plainOnly=createAddresseeContext(()=>({ok:true,messages:[event('m2',[text('@AI助手 这只是文字')])]}));assert.equal(plainOnly({...base,admittedMessages:[row(2,'@AI助手 这只是文字')]}),'','plain text cannot manufacture structured mentions');
});
test('actual bot mentions and several actual recipients remain distinct, in source order',()=>{
 const render=createAddresseeContext(()=>({ok:true,messages:[event('m3',[at('999')]),event('m4',[at('222'),at('333'),at('222')])]}));
 const facts=JSON.parse(render({...base,admittedMessages:[row(3,'@bot 你好'),row(4,'@甲 @乙 大家好')]}).split('\n')[1]);assert.equal(facts[0].addressedToBot,true);assert.deepEqual(facts[1].mentionedUserIds,['222','333']);assert.equal(facts[1].addressedToBot,false);
});

test('a bot mentioned as the action object does not become the leading recipient',()=>{
 const render=createAddresseeContext(()=>({ok:true,messages:[event('m5',[at('222'),text('你管管'),at('999')])]}));
 const fact=JSON.parse(render({...base,admittedMessages:[row(5,'@群友 你管管@bot')]}).split('\n')[1])[0];assert.deepEqual(fact.mentionedUserIds,['222','999']);assert.deepEqual(fact.leadingMentionUserIds,['222']);assert.equal(fact.addressedToBot,false);
});
test('group/account boundaries, private conversations and disabled identity cannot create an index',()=>{
 const render=createAddresseeContext(()=>({ok:true,messages:[event('m1',[at('999')],{group_id:789})]}));assert.equal(render({...base,admittedMessages:[row(1,'@bot hi')]}),'');
 const wrongBot=createAddresseeContext(()=>({ok:true,messages:[event('m1',[at('999')],{self_id:888})]}));assert.equal(wrongBot({...base,admittedMessages:[row(1,'@bot hi')]}),'');
 let reads=0;const p=createPlugin({config:{disabledBlocks:['identity']},addPromptBlock(){},capabilities:{readLocalConversationHistory(){reads++;}}});p.hooks.beforePrompt({...base,st:{recentMessages:[row(1,'@bot hi')]}});assert.equal(reads,0);
 assert.equal(render({...base,key:'private:111',admittedMessages:[row(1,'@bot hi')]}),'');
});
test('unchanged admitted messages reuse a bounded local result rather than reading cache on every model step',()=>{
 let reads=0;const render=createAddresseeContext(()=>{reads++;return{ok:true,messages:[event('m1',[at('222')])]};});const payload={...base,admittedMessages:[row(1,'@群友 帮忙看看')]};
 assert(render(payload));assert(render(payload));assert.equal(reads,1);
 const blocks=[],p=createPlugin({config:{},addPromptBlock:(t,options)=>blocks.push({t,options}),capabilities:{readLocalConversationHistory:()=>({ok:true,messages:[event('m1',[at('222')])]})}});p.hooks.beforePrompt(payload);assert(blocks.some(b=>b.t===ADDRESSEE_RULE&&b.options?.placement==='stable'));assert(blocks.some(b=>b.t.startsWith('【入站@对象')));
});
