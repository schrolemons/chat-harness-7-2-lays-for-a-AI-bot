import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPluginHost} from '../src/plugin-host.js';
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'plugin-contract-'));
function fixture(root,id,code,extra={},user=false){const d=path.join(root,'plugins',user?'qq-components-user':'qq-components',id);fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'plugin.json'),JSON.stringify({id,main:'index.mjs',...extra}));fs.writeFileSync(path.join(d,'index.mjs'),code);fs.writeFileSync(path.join(d,'skill.md'),'fixture');}
async function using(fn){const root=temp();try{await fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('user directory registration actually works and duplicate ids cannot replace builtins',()=>using(async root=>{
 fixture(root,'alpha',`export function createPlugin(){return {hooks:{beforePrompt(){return 'builtin'}}}}`);
 fixture(root,'alpha',`export function createPlugin(){throw Error('must not run')}}`,{},true);
 fixture(root,'user-one',`export function createPlugin(){return {hooks:{beforePrompt(){return 'user'}}}}`,{},true);
 const h=createPluginHost({root});await h.loadAll();assert.equal(h.summary().total,2);assert.equal(h.get('user-one').builtin,false);assert.deepEqual(h.collectPromptBlocks({}),['builtin','user']);await h.dispose();
}));
test('toggle revokes hooks tools services and old async capabilities immediately',()=>using(async root=>{
 let effects=0;fixture(root,'alpha',`export function createPlugin(ctx){ctx.registerTool('hello',{handler:()=>42});return {dispose(){ctx.capabilities.effect()},services:{a:{go(){return 7}}},hooks:{beforePrompt(){return 'alpha'},onIncoming(){globalThis.__oldPlugin=()=>ctx.capabilities.effect()}}}}`);
 const h=createPluginHost({root,capabilities:{effect(){effects++;}}});await h.loadAll();h.emitIncoming({});assert.equal(h.callService('a','go'),7);h.setEnabled('alpha',false);assert.deepEqual(h.collectPromptBlocks({}),[]);assert.equal(h.callService('a','go'),null);assert.equal((await h.callTool('hello')).ok,false);globalThis.__oldPlugin();delete globalThis.__oldPlugin;assert.equal(effects,0);await h.reload();assert.equal(h.get('alpha').enabled,false);await h.dispose();
}));
test('failed factory leaves no tools and neighbor still runs',()=>using(async root=>{
 fixture(root,'broken',`export function createPlugin(ctx){ctx.registerTool('zombie',{handler:()=>1});throw Error('broken factory')}`);
 fixture(root,'good',`export function createPlugin(){return {hooks:{beforePrompt(){return 'good'}}}}`);
 const h=createPluginHost({root});await h.loadAll();assert.equal((await h.callTool('zombie')).ok,false);assert.deepEqual(h.collectPromptBlocks({}),['good']);await h.dispose();
}));
test('async rejection in incoming, tick and service stays isolated',()=>using(async root=>{
 fixture(root,'broken',`export function createPlugin(){return {hooks:{async onIncoming(){throw Error('incoming')},async onTick(){throw Error('tick')}},services:{oops:{async go(){throw Error('service')}}}}}`,{schedule:{everyMs:60000}});
 const h=createPluginHost({root});await h.loadAll();h.emitIncoming({});await h.tick();assert.equal(await h.callService('oops','go'),null);await new Promise(r=>setTimeout(r,10));assert.equal(h.summary().warnings.length,3);await h.dispose();
}));
test('configured order applies to actual injection and long blocks keep their tail',()=>using(async root=>{
 fixture(root,'a',`export function createPlugin(ctx){return {hooks:{beforePrompt(){ctx.addPromptBlock('x'.repeat(2000)+'TAIL');return ''}}}}`,{order:10});
 fixture(root,'b',`export function createPlugin(){return {hooks:{beforePrompt(){return 'FIRST'}}}}`,{order:20});
 const h=createPluginHost({root});await h.loadAll();h.setOrder(['b','a']);const blocks=h.collectPromptBlocks({});assert.equal(blocks[0],'FIRST');assert.ok(blocks.join('').endsWith('TAIL'));assert.ok(blocks.every(b=>b.length<=1200));await h.dispose();
}));
test('unknown toggle cannot create a phantom plugin',()=>using(async root=>{const h=createPluginHost({root});await h.loadAll();assert.equal(h.setEnabled('missing',false).ok,false);await h.dispose();}));
test('disabled-by-default plugin enables and scoped toggle keeps neighbor generation alive',()=>using(async root=>{
 fixture(root,'off',`export function createPlugin(){return {hooks:{beforePrompt(){return 'ON'}}}}`,{enabled:false});
 fixture(root,'neighbor',`export function createPlugin(ctx){globalThis.__neighborSignal=ctx.signal;return {}}`);
 const h=createPluginHost({root});await h.loadAll();const old=globalThis.__neighborSignal;assert.equal(h.get('off').enabled,false);h.setEnabled('off',true);await h.reload('off');assert.equal(h.get('off').enabled,true);assert.deepEqual(h.collectPromptBlocks({}),['ON']);assert.equal(old.aborted,false);delete globalThis.__neighborSignal;await h.dispose();
}));
test('configuration validates, persists through reload, and affects actual prompt output',()=>using(async root=>{
 fixture(root,'configurable',`export function createPlugin(ctx){return {hooks:{beforePrompt(){return ctx.config.word}}}}`,{config:{word:'old',count:2},configSchema:{count:{min:1,max:5}}});
 const h=createPluginHost({root});await h.loadAll();assert.equal(h.setConfig('configurable',{count:10}).ok,false);assert.equal(h.setConfig('configurable',{typo:1}).ok,false);assert.equal(h.setConfig('configurable',{word:'NEW'}).ok,true);await h.reload('configurable');assert.deepEqual(h.collectPromptBlocks({}),['NEW']);assert.equal(h.get('configurable').config.word,'NEW');await h.dispose();
}));
test('late old-generation tool registration cannot revive after reload',()=>using(async root=>{
 fixture(root,'alpha',`export function createPlugin(ctx){globalThis.__lateRegister??=()=>ctx.registerTool('late',{handler:()=> 'old'});return {}}`);
 const h=createPluginHost({root});await h.loadAll();await h.reload();globalThis.__lateRegister();delete globalThis.__lateRegister;assert.equal((await h.callTool('late')).ok,false);await h.dispose();
}));
test('hanging factory and dispose time out so neighbors and later reload survive',()=>using(async root=>{
 fixture(root,'blocked',`export function createPlugin(){return new Promise(()=>{})}`);
 fixture(root,'good',`export function createPlugin(){return {dispose(){return new Promise(()=>{})},hooks:{beforePrompt(){return 'good'}}}}`);
 const h=createPluginHost({root,lifecycleTimeoutMs:25});await h.loadAll();assert.deepEqual(h.collectPromptBlocks({}),['good']);await h.reload();assert.deepEqual(h.collectPromptBlocks({}),['good']);await h.dispose();
}));
test('bridge builds real prompt blocks before bootstrap/normal delivery',()=>{
 const code=fs.readFileSync(new URL('../src/bridge.js',import.meta.url),'utf8');
 const start=code.indexOf('  function buildWakePromptV2('),end=code.indexOf('\n  function buildWakeReminderPromptV2',start);
 const fn=code.slice(start,end);
 // Compile the actual production function with controlled boundary dependencies, no bridge launch.
 const make=new Function('deps',`with(deps){${fn};return buildWakePromptV2;}`);
 const calls=[];let state={unread:[],recentMessages:[],agentToken:'fixture-token'};
 const deps={stickerEntries:[],readRoleState:()=>({role:'fixture'}),getSocialV2State:()=>state,moodCfgV2:()=>({enabled:false}),cfg:{socialV2:{}},replyTimingV2:()=>({}),isDirectedAtAi:()=>false,isAdminDevKey:()=>false,readPersistMemoryV2:()=>({}),readTaskNotesV2:()=>'',formatInitialPromptV2:()=> 'BOOT',lastIncomingTextV2:()=>'',pluginHost:{collectPromptBlocks(p){calls.push(p);return ['REAL_PLUGIN_BLOCK']},collectWakeTails:()=> 'TAIL'},selfDisplayName:'fish',selfUserId:'1',wakeReasonSeq:()=>null};
 const build=make(deps);assert.ok(build('private:1','bootstrap').includes('REAL_PLUGIN_BLOCK'));assert.equal(calls[0].initialPromptText,'BOOT');assert.ok(build('private:1','message').includes('REAL_PLUGIN_BLOCK'));assert.equal(calls[1].initialPromptText,'');
});
