import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {toolCatalogFingerprint,mergeToolEvidence} from '../src/tools/catalog.js';
import {WHALE_MCP_SERVERS} from '../src/tools/servers.js';
function fixture(run){const root=fs.mkdtempSync(path.join(os.tmpdir(),'catalog-freshness-'));const put=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};try{
 for(const s of WHALE_MCP_SERVERS)put(s.script,'export const fixture=true;');
 put('src/mcp-bilibili-tools.mjs','export const fixture=true;');put('src/tools/flags.js','export const fixture=true;');put('src/tools/servers.js','export const fixture=true;');put('config.json',{});put('state/mode.json',{mode:'reserved2'});
 put('plugins/qq-components/prompt-only/plugin.json',{id:'prompt-only',main:'index.js',config:{words:'hello'}});put('plugins/qq-components/prompt-only/index.js',"export const hooks={beforePrompt:()=> 'hello'};");
 put('plugins/qq-components/tool-fixture/plugin.json',{id:'tool-fixture',main:'index.js',enabled:true,config:{maxReadChars:4000}});put('plugins/qq-components/tool-fixture/index.js',"export function createPlugin(ctx){ctx.registerTool('fixture',{schema:{type:'object'},handler:()=>({ok:true})});}");
 return run({root,put,fingerprint:()=>toolCatalogFingerprint(root)});
}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('prompt-only implementation, manifest prose/config and unrelated registry changes do not stale tool verification',()=>fixture(({put,fingerprint})=>{
 const old=fingerprint();put('plugins/qq-components/prompt-only/index.js',"export const hooks={beforePrompt:()=> 'changed prompt'};");put('plugins/qq-components/prompt-only/plugin.json',{id:'prompt-only',main:'index.js',description:'changed',config:{words:'new'}});put('state/plugins/config/prompt-only.json',{words:'again'});put('state/plugins/registry.json',{disabled:['prompt-only']});assert.equal(fingerprint(),old);
}));
test('MCP imported helper implementation changes remain stale even when registration file is untouched',()=>fixture(({put,fingerprint})=>{
 put('src/mcp-snowluma-safe.js',"import {helper} from '../plugins/qq-components/ctx-chat-reply-shape/send-rejection.mjs';");put('plugins/qq-components/ctx-chat-reply-shape/send-rejection.mjs','export const helper=1;');const old=fingerprint();put('plugins/qq-components/ctx-chat-reply-shape/send-rejection.mjs','export const helper=2;');assert.notEqual(fingerprint(),old);
}));
test('new/removed registerTool owners, tool implementations, enable switches and schema configuration invalidate verification',()=>fixture(({put,fingerprint,root})=>{
 let old=fingerprint();put('plugins/qq-components/new-tool/plugin.json',{id:'new-tool',main:'index.js',enabled:true});put('plugins/qq-components/new-tool/index.js',"export const createPlugin=ctx=>ctx.registerTool('new',{});");assert.notEqual(fingerprint(),old);old=fingerprint();put('plugins/qq-components/new-tool/index.js','export const createPlugin=()=>({});');assert.notEqual(fingerprint(),old);
 old=fingerprint();put('plugins/qq-components/tool-fixture/index.js',"export function createPlugin(ctx){ctx.registerTool('fixture',{schema:{type:'object'},handler:()=>({ok:false})});}");assert.notEqual(fingerprint(),old);
 old=fingerprint();put('state/plugins/registry.json',{disabled:['tool-fixture']});assert.notEqual(fingerprint(),old);
 old=fingerprint();put('state/plugins/config/tool-fixture.json',{maxReadChars:2000});assert.notEqual(fingerprint(),old);
 old=fingerprint();put('config.json',{socialV2:{tools:{waitMessages:false}}});assert.notEqual(fingerprint(),old);
}));
test('catalog status distinguishes unverified freshness from confirmed leaked admin or removed injected tools',async()=>{
 const {toolCatalogStatus}=await import('../console/layers/T/tool-inventory.js');assert.equal(typeof toolCatalogStatus,'function');
 const normal=mergeToolEvidence([{name:'snowluma',audience:'qq',ok:true,tools:[{name:'qq_status'}]}],[{preset:'qq-chat-v2',names:['mcp__snowluma__qq_status']}]);
 const pending=toolCatalogStatus({tools:normal,servers:[],stale:true});assert.notEqual(pending.tone,'err');assert.match(pending.text,/1 个聊天工具有实际注入记录/);assert.match(pending.text,/待核验/);
 const leaked=mergeToolEvidence([{name:'bridge-health',audience:'admin',ok:true,tools:[{name:'bridge_health'}]}],[{preset:'qq-chat-v2',names:['mcp__bridge-health__bridge_health']}]);assert.equal(toolCatalogStatus({tools:leaked,servers:[],stale:false}).tone,'err');
 const removed=mergeToolEvidence([{name:'snowluma',audience:'qq',ok:true,tools:[]}],[{preset:'qq-chat-v2',names:['mcp__snowluma__removed']}]);assert.equal(toolCatalogStatus({tools:removed,servers:[],stale:false}).tone,'err');assert.equal(toolCatalogStatus({tools:[],servers:[{ok:false}],stale:false}).tone,'err');
});
