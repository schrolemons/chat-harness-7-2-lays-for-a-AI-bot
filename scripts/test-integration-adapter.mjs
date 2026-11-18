import test from'node:test';import assert from'node:assert/strict';
import{createPlugin}from'../plugins/qq-components/integration-registry/index.js';
import{createBridgeAdapter}from'../plugins/qq-components/integration-registry/adapter.mjs';
function fixture(){
 const blocks=[],warnings=[];let alive=true,disabled=false,room={revision:1,location:'书桌'},calls=0;
 const registry=createPlugin({runtime:{},registerTool(){},addPromptBlock:t=>blocks.push(t),isPluginEnabled:()=>!disabled,callService:()=>({text:'温和但有主见'}),warn:t=>warnings.push(t)});
 const ctx={id:'room-test',isActive:()=>alive,callService:(s,m,p)=>registry.services[s]?.[m](p)};
 const adapter=createBridgeAdapter(ctx,{keys:['private:123'],snapshot:()=>room,actions:{drink:async({context})=>{calls++;return {status:'queued',drink:context.memory.includes('乌龙茶')?'乌龙茶':'水'};},read:()=>({status:'completed',revision:room.revision}),bad:()=>({ok:true})}});
 adapter.hooks.beforePrompt();return {registry,adapter,blocks,warnings,calls:()=>calls,unload:()=>alive=false,disable:()=>disabled=true,state:v=>room=v,project:(p={})=>registry.hooks.beforePrompt({key:'private:123',roleName:'AI助手',persistentMemory:{text:'已确认喜欢乌龙茶'},moodState:{score:60,mode:'normal'},agentToken:'SECRET_MUST_NOT_APPEAR',...p})};
}
test('adapter state joins current context; memory and personality reach its behavior without QQ or a second LLM',async()=>{
 const f=fixture();f.project();assert.match(f.blocks.join('\n'),/第三方插件状态 room-test/);
 const context=f.adapter.services.integrationAdapter.context({key:'private:123'});assert.match(context.memory,/乌龙茶/);assert.equal(context.role.name,'AI助手');assert.match(context.role.style,/主见/);assert.equal(context.mood.score,60);assert.doesNotMatch(JSON.stringify(context),/SECRET/);
 context.memory='不应修改拥有源';assert.match(f.adapter.services.integrationAdapter.context({key:'private:123'}).memory,/乌龙茶/);
 const r=await f.adapter.services.integrationAdapter.invoke({key:'private:123',action:'drink'});assert.deepEqual(r,{status:'queued',drink:'乌龙茶',ok:false});assert.equal(f.calls(),1);
 assert.equal((await f.adapter.services.integrationAdapter.invoke({key:'private:123',action:'read'})).ok,true);
 assert.equal((await f.adapter.services.integrationAdapter.invoke({key:'private:123',action:'bad'})).status,'unknown');
});
test('scope, unload and disabled adapters cannot read another conversation or execute actions',async()=>{
 const f=fixture();f.project();assert.equal(f.adapter.services.integrationAdapter.context({key:'group:123'}),null);
 assert.equal((await f.adapter.services.integrationAdapter.invoke({key:'group:123',action:'drink'})).status,'rejected');
 f.disable();assert.equal(f.adapter.services.integrationAdapter.context({key:'private:123'}),null);assert.equal((await f.adapter.services.integrationAdapter.invoke({key:'private:123',action:'drink'})).status,'rejected');
 f.unload();assert.equal(f.registry.services.integrationContext.list().length,0);assert.equal(f.calls(),0);
});
test('oversized or asynchronous snapshots fail locally and never abort another plugin or retain stale context',()=>{
 const f=fixture();f.project();f.blocks.length=0;f.state({text:'字'.repeat(2200)});f.project();assert.equal(f.blocks.length,0);assert.equal(f.warnings.length,1);assert.equal(f.adapter.services.integrationAdapter.context({key:'private:123'}),null);
 f.state(Promise.resolve({bad:true}));f.project();assert.equal(f.blocks.length,0);assert.equal(f.warnings.length,2);
 f.state({revision:2});f.project();assert.match(f.blocks.join('\n'),/"revision":2/);
});
