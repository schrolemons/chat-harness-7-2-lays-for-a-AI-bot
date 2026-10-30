import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/tool-bilibili/index.js';
import {createOutboundTransport} from '../src/outbound-context.js';
import {bridgeHarness} from './audit-bridge-harness.mjs';

const now=Date.parse('2026-10-30T09:00:00+08:00');
const config={keywords:['海洋','鲸鱼'],topicUploaders:[{topic:'鲸鱼',uploader:'关联作者',weight:2}],maxItems:2};
const video=(suffix,uploader='新作者')=>({bvid:'BV1xx411c7m'+suffix,title:'海洋里的鲸鱼',description:'海洋与鲸鱼的记录',uploader});
function fixture(search,samples=[0.9,0.9,0,0]){
 let state={},plan;const queries=[];let draws=0;
 const plugin=createPlugin({config:{},registerTool(){},state:{get:()=>structuredClone(state),set:p=>{state={...state,...p};}},capabilities:{readBiliSharePlan:()=>plan}},
  {runtime:{handlers:{search:async input=>{queries.push(input.keyword);return search(input);}},dispose(){}},random:()=>{draws++;return samples.shift()??0;},now:()=>now});
 const service=plugin.services?.biliRecommendations;
 assert.ok(service,'daily recommendations must have an owning service');
 return {service,queries,get draws(){return draws;},setPlan(value){plan=value;},get state(){return state;}};
}

test('each video slot uses a fresh topic and uploader draw; independent draws may also repeat',async()=>{
 const f=fixture(async()=>({status:'ok',items:[]}));
 const plan=f.service.draw({key:'private:123',date:'2026-10-30',at:now,config});
 assert.equal(f.draws,4);
 assert.deepEqual(plan.draws.map(x=>[x.topic,x.preferredUploader]),[['鲸鱼','关联作者'],['海洋','']]);
 const repeated=fixture(async()=>({status:'ok',items:[]}),[0.9,0.9,0.9,0.9]);
 assert.deepEqual(repeated.service.draw({key:'private:123',date:'2026-10-30',at:now,config}).draws.map(x=>x.topic),['鲸鱼','鲸鱼']);
});

test('targeted candidate is selected by verified author; base slot excludes configured authors and duplicate videos',async()=>{
 const f=fixture(async({keyword})=>({status:'ok',items:keyword.includes('关联作者')?[video('D','其他作者'),video('E','关联作者')]:[video('E','关联作者'),video('F')]}));
 const raw=f.service.draw({key:'private:123',date:'2026-10-30',at:now,config});
 const plan=await f.service.resolve({plan:raw});
 assert.deepEqual(plan.items.map(x=>x.bvid),['BV1xx411c7mE','BV1xx411c7mF']);
 assert.deepEqual(f.queries,['鲸鱼 关联作者','海洋']);
 assert.equal(f.draws,4,'searching must not reroll any slot');
 f.setPlan(plan);
 assert.equal(f.service.validateOutbound({key:'private:123',reason:'newsShare',text:'https://www.bilibili.com/video/BV1xx411c7mD'}).ok,false);
 assert.equal(f.service.validateOutbound({key:'private:123',reason:'newsShare',text:plan.items[0].url}).ok,true);
 assert.equal(f.service.validateOutbound({key:'private:123',sourceKey:'private:456',reason:'newsShare',text:plan.items[0].url}).ok,false);
 assert.equal(f.service.validateOutbound({key:'private:123',planId:'old-plan',reason:'newsShare',text:plan.items[0].url}).ok,false);
 f.service.sent({key:'private:123',originReason:'newsShare',text:plan.items[0].url,success:true});
 assert.equal(f.service.validateOutbound({key:'private:123',reason:'newsShare',text:plan.items[0].url}).ok,false);
 assert.equal(f.service.validateOutbound({key:'private:123',reason:'message',text:'普通聊天'}).ok,true);
});

test('only an empty qualified targeted search allows fallback; errors skip without rerolling',async()=>{
 const f=fixture(async({keyword})=>keyword.includes('关联作者')?{status:'ok',items:[video('D','不符作者')]}:{status:'ok',items:[video('F')]});
 const raw=f.service.draw({key:'private:123',date:'2026-10-30',at:now,config:{...config,maxItems:1}});
 const plan=await f.service.resolve({plan:raw});
 assert.equal(plan.draws[0].usedFallback,true);assert.equal(plan.items[0].uploader,'新作者');
 const failed=fixture(async()=>{throw Error('search unavailable');});
 const empty=await failed.service.resolve({plan:failed.service.draw({key:'private:123',date:'2026-10-30',at:now,config:{...config,maxItems:1}})});
 assert.equal(empty.items.length,0);assert.equal(empty.draws[0].status,'error');assert.equal(failed.queries.length,1);
});

test('daily outbound is rejected before reservations when source verification is missing or fails',async()=>{
 let reservations=0,sends=0;
 const transport=createOutboundTransport({clock:()=>now,sleep:async()=>{},callService:(s,m)=>{
  if(s==='biliRecommendations'&&m==='validateOutbound')return {ok:false,reason:'unverified_video'};
  if(s==='replyPlan'&&m==='reserve'){reservations++;return {ok:true};}
  return null;
 }});
 const context=transport.capture({key:'private:123',reason:'newsShare',agent:true});
 await assert.rejects(transport.perform({key:'private:123',context,text:video('D').bvid,send:async()=>{sends++;return {};}}),/推荐|unverified/);
 assert.equal(reservations,0);assert.equal(sends,0);
});

test('video selection rejects unrelated or incomplete metadata, and duplicates cannot fill another slot',async()=>{
 const f=fixture(async()=>({status:'ok',items:[{...video('D'),title:'无关内容',description:'无关内容'},video('E'),{...video('F'),description:''}]}),[0,0,0,0]);
 const plan=await f.service.resolve({plan:f.service.draw({key:'private:123',date:'2026-10-30',at:now,config})});
 assert.deepEqual(plan.items.map(x=>x.bvid),['BV1xx411c7mE']);
 assert.equal(plan.draws[1].status,'no-qualified-video');
 assert.equal(f.draws,4);
});

test('a plan changing during send delay is rechecked before the gateway is called',async()=>{
 let allowed=true,sends=0,released=false;
 const transport=createOutboundTransport({clock:()=>now,sleep:async()=>{allowed=false;},callService:(s,m)=>{
  if(s==='biliRecommendations'&&m==='validateOutbound')return {ok:allowed};
  if(s==='replyPlan'&&m==='reserve')return {ok:true,waitMs:1};
  if(s==='replyPlan'&&m==='release')released=true;
  return null;
 }});
 const context=transport.capture({key:'private:123',reason:'newsShare',agent:true});
 await assert.rejects(transport.perform({key:'private:123',context,text:video('D').bvid,send:async()=>{sends++;return {};}}),/推荐/);
 assert.equal(sends,0);assert.equal(released,true);
});

test('verified daily video reaches the gateway once and its real success receipt prevents a repeat',async()=>{
 const f=fixture(async()=>({status:'ok',items:[video('E','关联作者')]}));
 const plan=await f.service.resolve({plan:f.service.draw({key:'private:123',date:'2026-10-30',at:now,config:{...config,maxItems:1}})});f.setPlan(plan);
 let sends=0;
 const transport=createOutboundTransport({clock:()=>now,sleep:async()=>{},callService:(service,method,payload)=>{
  if(service==='biliRecommendations')return f.service[method](payload);
  if(service==='replyPlan'&&method==='reserve')return {ok:true,waitMs:0};
  return null;
 }});
 const context=transport.capture({key:'private:123',envelope:{key:'private:123',reason:'newsShare',biliPlanId:plan.id,actionId:'daily-fixture'},agent:true});
 const send=()=>transport.perform({key:'private:123',context,text:plan.items[0].url,send:async()=>{sends++;return {data:{message_id:7}};}});
 await send();assert.equal(sends,1);
 await assert.rejects(send(),/video_already_delivered/);assert.equal(sends,1);
});

test('bridge restores independent draws and verified candidates without rerolling on restart',async()=>{
 const f=fixture(async({keyword})=>({status:'ok',items:[video(keyword.includes('关联作者')?'E':'F',keyword.includes('关联作者')?'关联作者':'新作者')]}));
 const plan=await f.service.resolve({plan:f.service.draw({key:'private:123',date:'2026-10-30',at:now,config})});
 const savedState={paused:false,conversations:{'private:123':{recentMessages:[],unread:[],lastNewsDate:plan.date,pendingBiliShare:plan}}};
 const h=await bridgeHarness({files:{'state/social-v2.json':savedState},globals:{structuredClone}});try{
  const restored=h.taskCaps.readBiliSharePlan('private:123');
  assert.equal(restored.id,plan.id);assert.equal(restored.resolved,true);assert.equal(restored.version,2);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.draws)),plan.draws);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.items)),plan.items);
  assert.equal(f.draws,4);
 }finally{await h.close();}
});

test('actual daily timer persists one independent plan before search and does not redraw that day',async()=>{
 const key='private:789',f=fixture(async({keyword})=>({status:'ok',items:[video(keyword.includes('关联作者')?'E':'F',keyword.includes('关联作者')?'关联作者':'新作者')]}));
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const h=await bridgeHarness({config:{allow:{private:['789'],groups:[]},socialV2:{enabled:true,dailyNews:{...config,enabled:true,hour:9,minute:0,sessionWhitelist:[key]}}},globals:{structuredClone,Date:FixedDate}});
 let server;
 try{
  h.setMode('reserved2');
  const call=h.pluginHost.callService.bind(h.pluginHost),calls=[];let scheduled;
  h.pluginHost.callService=(service,method,payload)=>{
   if(service==='scheduler'&&method==='schedule'&&payload.type==='newsTimer'){scheduled=payload;return {scheduledId:payload.id,unref(){}};}
   if(service==='proactive'&&method==='isCurfew')return false;
   if(service==='biliRecommendations'){
    calls.push(method);
    if(method==='resolve')assert.equal(h.getSocialV2State(key).pendingBiliShare.id,payload.plan.id,'draw must already be persisted before network work');
    return f.service[method](payload);
   }
   return call(service,method,payload);
  };
  const st=h.getSocialV2State(key);
  server=h.startConsoleServer();if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/socialV2/config',{method:'POST',headers:{'content-type':'application/json','x-console-token':'fixture-console-token'},body:JSON.stringify({dailyNews:{...config,enabled:true,hour:9,minute:0,sessionWhitelist:[key]}})});
  assert.equal(response.status,200);await response.json();
  assert.ok(scheduled,'the existing daily scheduler must own the timer');
  const first=scheduled;first.run();
  for(let i=0;i<50&&!st.pendingBiliShare?.resolved;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(st.pendingBiliShare?.resolved,true);assert.equal(st.pendingBiliShare.draws.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(st.pendingBiliShare.draws.map(x=>x.topic))),['鲸鱼','海洋']);
  assert.equal(st.pendingBiliShare.items.length,2);assert.equal(f.draws,4);
  first.run();await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(calls.filter(method=>['draw','resolve'].includes(method)),['draw','resolve']);
  assert.equal(f.draws,4);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await h.close();}
});
