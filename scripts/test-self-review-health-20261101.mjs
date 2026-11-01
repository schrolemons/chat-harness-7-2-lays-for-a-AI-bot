// Execute the scanner against temporary local files and stubbed HTTP/process calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createPlugin} from '../plugins/qq-components/obs-bridge-health/index.js';
import {readBridgeHealth} from '../plugins/qq-components/obs-bridge-health/health.mjs';
const source=fs.readFileSync(new URL('./self-review.mjs',import.meta.url),'utf8');

test('owner maintenance health instructions require actual tool availability and defer to injected scan health otherwise',()=>{
 let help;const plugin=createPlugin({registerTool:(name,definition)=>help=definition.handler});
 const text=plugin.hooks.beforePrompt({isOwnerKey:true,reason:'selfReview'});
 assert.match(text,/当前工具列表/);assert.match(text,/扫描健康摘要/);assert.match(text,/qq_status[\s\S]*不能[\s\S]*整链/);
 assert.match(help().rule,/当前工具列表/);assert.equal(plugin.hooks.beforePrompt({isOwnerKey:false,reason:'selfReview'}),'');
});

async function scan(status){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'self-review-health-'));const requests=[];let output;
 try{
  fs.mkdirSync(path.join(root,'scripts'));fs.mkdirSync(path.join(root,'state'));fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({consolePort:43219,consoleToken:'fixture_console_key_123'}));
  const fakeFetch=async(url,options={})=>{requests.push({url:String(url),options});if(status===0)throw Error('fixture network unavailable');return {status,ok:status===200,json:async()=>({dshReady:true,snowluma:{connected:true,accountOnline:true,good:true,lastPacketAgoMs:2}})};};
  const executable=source.replace(/^#![^\n]*\n/,'').replace(/^import .*;\s*$/gm,'').replaceAll('import.meta.url',JSON.stringify(pathToFileURL(path.join(root,'scripts/self-review.mjs')).href));
  const ctx=vm.createContext({fs,path,fileURLToPath,process:{argv:['node','fixture']},fetch:fakeFetch,AbortSignal,execSync:()=>{throw Error('fixture task absent');},readBridgeHealth:opts=>readBridgeHealth({...opts,fetchFn:fakeFetch}),console:{log:value=>output=JSON.parse(value)}});
  await vm.runInContext('(async()=>{'+executable+'})()',ctx);return {output,requests};
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('maintenance scanner authenticates configured local console and reports HTTP 401 as auth_required',async()=>{
 const {output,requests}=await scan(401);assert.equal(output.bridgeHealth?.verdict,'auth_required');assert.equal(output.bridgeHealth.healthy,false);
 assert.equal(requests.length,1);assert.equal(requests[0].url,'http://127.0.0.1:43219/api/status');assert.equal(requests[0].options.headers['x-console-token'],'fixture_console_key_123');
 assert.match(output.summary,/扫描健康摘要[\s\S]*auth_required/);assert(!JSON.stringify(output).includes('fixture_console_key_123'));assert(!/桥接控制台\(3100\) OK/.test(output.summary));
});
test('maintenance scanner distinguishes authenticated ready from unreachable without declaring a restart',async()=>{
 const good=await scan(200),bad=await scan(0);assert.equal(good.output.bridgeHealth?.verdict,'ready');assert.equal(bad.output.bridgeHealth?.verdict,'console_unreachable');
 assert.equal(good.output.bridgeHealth.needsRestart,false);assert.equal(bad.output.bridgeHealth.needsRestart,false);assert.match(good.output.summary,/扫描健康摘要[\s\S]*ready/);
});
