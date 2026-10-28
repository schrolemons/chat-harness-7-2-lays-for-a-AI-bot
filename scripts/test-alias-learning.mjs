import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/ctx-member-alias/index.js';
import {bridgeHarness} from './audit-bridge-harness.mjs';

export function aliasFixture(config={}) {
  let state={};const tools=new Map();
  const ctx={config:{autoExtract:true,...config},runtime:{},isActive:()=>true,
    state:{get:()=>structuredClone(state),set:p=>(state={...state,...structuredClone(p)})},
    registerTool:(n,s)=>tools.set(n,s),log:()=>{},warn:()=>{},
    capabilities:{getOwnerQQ:()=>608,getLearningMembers:async()=>[
      {userId:'10608',nickname:'小明',card:'明明'},{userId:'987654321',nickname:'阿乙',card:'阿乙'}
    ]}};
  return {ctx,plugin:createPlugin(ctx),state:()=>state,call:(name,input={})=>tools.get(name).handler(input)};
}
test('an empty alias table still tells the bot the real query and submission tools',()=>{
  const h=aliasFixture();const prompt=h.plugin.hooks.beforePrompt({key:'group:456'});
  assert.match(prompt,/qq_alias_submit/);assert.match(prompt,/qq_alias_query/);assert.doesNotMatch(prompt,/alias_add 登记/);
});
test('one QQ can have multiple aliases without replacing confirmed aliases',()=>{
  const h=aliasFixture();h.call('alias_add',{alias:'小明',qq:'10608'});
  h.call('alias_submit',{alias:'金牌快递员',qq:'10608',key:'group:456'});
  assert.equal(h.state().entries.length,2);
  assert.equal(h.state().entries.find(x=>x.alias==='小明').status,'confirmed');
});
test('explicit third-party statements resolve the target, never the speaker',async()=>{
  const h=aliasFixture();await h.plugin.hooks.onIncoming({key:'group:456',userId:'987654321',sender:'阿乙',text:'金牌快递员是明明的绰号',messageId:'msg-1'});
  assert.equal(h.state().entries[0].alias,'金牌快递员');assert.equal(h.state().entries[0].qq,'10608');
  assert.equal(h.state().entries[0].status,'candidate');assert.ok(h.state().entries[0].evidence.length);
});
test('possible names in invitations and questions stay unbound for administrator review',async()=>{
  const h=aliasFixture();
  for(const [i,text] of ['快递猫还不来玩游戏吗','你去问问橘子猫','@【明明】小黄猫'].entries())
    await h.plugin.hooks.onIncoming({key:'group:456',userId:'987654321',sender:'阿乙',text,messageId:'suspect-'+i});
  assert.ok(h.state().entries.some(x=>x.alias==='快递猫'&&!x.qq));
  assert.ok(h.state().entries.some(x=>x.alias==='橘子猫'&&!x.qq));
  assert.ok(h.state().entries.some(x=>x.alias==='小黄猫'&&x.qq==='10608'));
});
test('unbound candidates require a QQ before confirmation and can be edited by id',async()=>{
  const h=aliasFixture();await h.plugin.hooks.onIncoming({key:'group:456',userId:'987654321',text:'你去问问快递猫',messageId:'m'});
  const entry=h.state().entries[0];assert.equal(h.call('alias_confirm',{id:entry.id}).ok,false);
  assert.equal(h.call('alias_confirm',{id:entry.id,alias:'快递猫',qq:'10608'}).ok,true);
  assert.match(h.plugin.hooks.beforePrompt({key:'group:456'}),/快递猫 = 608/);
});
test('duplicate hooks merge evidence and deleting an alias cannot delete another alias of the QQ',async()=>{
  const h=aliasFixture();const message={key:'group:456',userId:'10608',text:'叫我小黄猫',messageId:'same'};
  await h.plugin.hooks.onIncoming(message);await h.plugin.hooks.onIncoming(message);
  assert.equal(h.state().entries.length,1);assert.equal(h.state().entries[0].evidence.length,1);
  h.call('alias_add',{alias:'另一个称呼',qq:'10608'});
  h.call('alias_reject',{id:h.state().entries[0].id});assert.equal(h.state().entries.length,1);
  assert.equal(h.state().entries[0].alias,'另一个称呼');
});
test('negative or quoted self-naming and platform names do not silently become aliases',async()=>{
  const h=aliasFixture();
  for(const text of ['不要叫我小黄猫','他说“叫我小黄猫”','金牌快递员不是明明的绰号','这个是绰号吗？','普通聊天'])
    await h.plugin.hooks.onIncoming({key:'group:456',userId:'987654321',sender:'平台昵称',text});
  assert.equal((h.state().entries||[]).length,0);
});
test('agent submissions may omit QQ, but cannot confirm or change existing confirmed entries',()=>{
  const h=aliasFixture();const result=h.call('alias_submit',{alias:'快递猫',key:'group:456',note:'群友说去问问快递猫'});
  assert.equal(result.ok,true);assert.equal(result.entry.status,'candidate');assert.equal(result.entry.qq,'');
});
test('manual refresh scans allowed history and analyzes one nickname candidate once',async()=>{
 const h=aliasFixture();let scans=0,calls=0;
 h.ctx.capabilities.getLearningHistory=async input=>{scans++;assert.equal(input.limit,100);return [{key:'group:456',userId:'10608',sender:'小明',text:'叫我快递猫',messageId:'refresh-1'},{key:'group:456',userId:'987654321',sender:'阿乙',text:'快递猫今天上线了',messageId:'refresh-2'}];};
 h.ctx.capabilities.learningPrompt=async()=>{calls++;return JSON.stringify({entries:[{alias:'快递猫',qq:'10608',targetName:'小明',sourceIds:[1],confidence:.99,reason:'明确自称'}]});};
 const result=await h.call('alias_refresh');assert.equal(scans,1);assert.equal(calls,1);assert.equal(result.processed,1);assert.equal(h.state().entries.filter(x=>x.alias==='快递猫').length,1);
});
test('rejecting a suspected alias prevents automatic resubmission of the same claim',async()=>{
 const h=aliasFixture();await h.plugin.hooks.onIncoming({key:'group:456',userId:'987654321',text:'你去问问快递猫',messageId:'first'});
 h.call('alias_reject',{id:h.state().entries[0].id});
 await h.plugin.hooks.onIncoming({key:'group:456',userId:'987654321',text:'你去问问快递猫',messageId:'second'});
 assert.equal(h.state().entries.length,0);
});
test('semantic alias learning has an hourly cap and does not reprocess idle windows',async()=>{
 const h=aliasFixture({minMessages:1,cooldownMs:1,maxCallsPerHour:1});let calls=0;
 h.ctx.capabilities.learningPrompt=async()=>{calls++;return '{"entries":[]}';};
 await h.plugin.hooks.onIncoming({key:'group:456',userId:'987654321',text:'一起玩游戏',messageId:'first'});
 await h.plugin.hooks.onTick({now:Date.now()});
 await h.plugin.hooks.onTick({now:Date.now()+3600000});
 assert.equal(calls,1,'no new material must not trigger another paid request');
 await h.plugin.hooks.onIncoming({key:'group:456',userId:'987654321',text:'今天也一起玩',messageId:'second'});
 await h.plugin.hooks.onTick({now:Date.now()+3600000});
 assert.equal(calls,1,'new material must still obey the real rolling hourly budget');
});
test('the live alias query route unwraps the plugin envelope',async()=>{
  const h=await bridgeHarness();h.setMode('reserved2');const st=h.getSocialV2State('group:456');
  const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
  try{
    await h.pluginHost.callTool('alias_add',{alias:'路由测试',qq:'10608'});
    const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/socialV2/alias/query?key=group:456&q='+encodeURIComponent('路由测试'),{headers:{'x-console-token':'fixture-console-token','x-agent-token':st.agentToken}});
    const data=await r.json();assert.equal(r.status,200);assert.equal(data.entries.length,1);assert.equal(data.entries[0].alias,'路由测试');
  }finally{await new Promise(r=>server.close(r));await h.close();}
});
