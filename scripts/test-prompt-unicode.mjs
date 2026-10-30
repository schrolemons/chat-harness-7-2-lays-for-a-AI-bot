import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPluginHost} from '../src/plugin-host.js';
async function withPrompt(text,run){const root=fs.mkdtempSync(path.join(os.tmpdir(),'unicode-prompt-'));const dir=path.join(root,'plugins/qq-components/fixture');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'plugin.json'),JSON.stringify({id:'fixture',main:'index.mjs'}));fs.writeFileSync(path.join(dir,'index.mjs'),`export function createPlugin(){return {hooks:{beforePrompt(){return ${JSON.stringify(text)}}}}}`);const host=createPluginHost({root});try{await host.loadAll();await run(host);}finally{await host.dispose();fs.rmSync(root,{recursive:true,force:true});}}
test('1200-unit plugin chunks never split an emoji into isolated surrogates',()=>withPrompt('a'.repeat(1199)+'🥢'+'z'.repeat(90),host=>{const blocks=host.collectPromptBlocks({});assert.ok(blocks.every(x=>x.isWellFormed()));assert.ok(blocks.join('\n\n').includes('🥢'));}));
test('8000-unit total cap drops a partial code point rather than leaving a broken surrogate',()=>withPrompt('a'.repeat(7999)+'🥢',host=>{const m=host.collectPromptModules({});assert.ok(m[0].text.isWellFormed());assert.ok(m[0].text.length<=8000);}));
test('literal malformed source characters cannot reach the assembled prompt',()=>withPrompt('prefix\ud83e suffix',host=>{assert.ok(host.collectPromptBlocks({}).join('\n\n').isWellFormed());}));
import { NodeApiClient } from '../src/dsh-client.js';
test('the DSH prompt boundary repairs old split pairs without mutating caller input',async()=>{const client=new NodeApiClient('http://127.0.0.1:1',1000,{});let body;client.postJson=async(_url,envelope)=>{body=envelope.payload.args.request;return {json:async()=>({type:'server-response',rpcId:envelope.rpcId,result:{ok:true,value:{}}})};};const text='before\ud83e\n\n\udd62 after';const original={sessionId:'fixture',content:[{type:'text',text}]};await client.callUnary('session/prompt',original);assert.equal(original.content[0].text,text);assert.equal(body.content[0].text,'before🥢 after');});
