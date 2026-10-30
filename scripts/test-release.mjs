import {parse} from 'acorn';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import yaml from 'js-yaml';
import {configure} from './configure.mjs';import {createPluginHost} from '../src/plugin-host.js';import {createRuntime} from '../plugins/qq-components/personal-core/runtime.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('long and accumulated monitor notifications fit transport limits and retain stable retry ids',async()=>{
 const {notificationBatches}=await import('./web-notification-items.mjs');const changes=Array.from({length:21},(_,i)=>({deliveryId:`site-${i}`,msg:'资料'.repeat(1500),sourceAt:123}));
 const batches=notificationBatches(changes),items=batches.flat();assert.equal(items.length,42);assert.ok(batches.every(batch=>batch.length<=20));assert.ok(items.every(item=>item.text.length<=2000));assert.equal(new Set(items.map(item=>item.id)).size,42);assert.deepEqual(notificationBatches(changes),batches);assert.equal(items.slice(0,2).map(item=>item.text).join(''),changes[0].msg);
});
test('every static local module import resolves inside the complete distribution',()=>{
 const files=[];const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git','state'].includes(e.name))continue;const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.(?:js|mjs)$/.test(e.name))files.push(f);}};walk(root);
 const missing=[];for(const file of files){
  const tree=parse(fs.readFileSync(file,'utf8'),{ecmaVersion:'latest',sourceType:'module',allowHashBang:true});
  const walk=node=>{if(!node||typeof node!=='object')return;
   const source=['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(node.type)?node.source:null;
   if(source?.type==='Literal'&&typeof source.value==='string'&&source.value.startsWith('.')){const relative=source.value.split('?')[0];if(!fs.existsSync(path.resolve(path.dirname(file),relative)))missing.push(path.relative(root,file)+' -> '+relative);}
   for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);
  };walk(tree);
 }

 assert.deepEqual(missing,[]);
});
test('all packaged components load, including general reference and Codex Peer support',async()=>{
 const host=createPluginHost({root,capabilities:{}});try{const summary=await host.loadAll();assert.ok(summary.count>=40);assert.deepEqual(summary.warnings,[]);assert.ok(host.hasService('personal-core','status'));assert.ok(!host.hasService('schnie','status'));assert.ok(host.hasService('admin-dev','line'));}finally{await host.dispose();}
});
test('public S ships unmounted and only the separate fictional example is readable',()=>{
 const dir=path.join(root,'plugins/qq-components/personal-core'),config=JSON.parse(fs.readFileSync(path.join(dir,'plugin.json'))).config;
 assert.equal(config.libraryDir,'');assert.deepEqual(config.careSessionKeys,[]);assert.deepEqual(config.referenceSessionKeys,[]);
 assert.equal(createRuntime({root,config}).status().ok,false);
 const runtime=createRuntime({root,config:{...config,libraryDir:'examples/personal-core/minimal'}});assert.equal(runtime.status().topicCount,2);assert.equal(runtime.read({id:'example:boundaries'}).ok,true);assert.equal(fs.existsSync(path.join(root,'private-libraries')),false);
});
test('all DSH bundle patch resources and every MCP entrypoint ship with the repository',()=>{
 for(const name of ['qq-mode-console','qq-agent-presets']){const dir=path.join(root,'plugins',name),pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json')));const patches=[pkg.dsh.bundle.patch].flat();for(const rel of patches)assert.ok(fs.existsSync(path.resolve(dir,rel)),name+' missing '+rel);}
 for(const rel of ['plugins/wake-contracts.json','plugins/qq-agent-presets/presets/campus-summary.patch.yml','src/mcp-snowluma-safe.js','src/mcp-host-server.js','src/mcp-web-search-safe.js','src/mcp-bridge-health.mjs','plugins/qq-components/tool-codex-chat/src/mcp-server.mjs','plugins/qq-components/personal-core/mcp.mjs'])assert.ok(fs.existsSync(path.join(root,rel)),rel);
});
test('empty local configuration and two installations preserve a separate DSH profile without duplicate integrations',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'chat-harness-install-'));
 try{
  const fakeRoot=path.join(temp,'project'),snow=path.join(temp,'snow'),home=path.join(temp,'dsh'),profile=path.join(home,'profiles','desktop');
  fs.mkdirSync(fakeRoot,{recursive:true});fs.copyFileSync(path.join(root,'config.example.json'),path.join(fakeRoot,'config.example.json'));fs.mkdirSync(snow);fs.writeFileSync(path.join(snow,'index.mjs'),'');fs.writeFileSync(path.join(snow,process.platform==='win32'?'node.exe':'launcher.sh'),'');
  const configured=configure({owner:'10001',snowlumaDir:snow},fakeRoot);assert.equal(configured.configured,true);const cfg=JSON.parse(fs.readFileSync(path.join(fakeRoot,'config.json')));assert.equal(cfg.allowAllWhenEmpty,false);assert.deepEqual(cfg.allow.private,['10001']);assert.equal(cfg.snowluma.accessToken,'');
  fs.mkdirSync(profile,{recursive:true});fs.writeFileSync(path.join(profile,'package.json'),JSON.stringify({name:'test-profile',private:true,dsh:{profile:{bundles:[]}}}));fs.writeFileSync(path.join(profile,'cordis.patch.yml'),'- insert:\n    - id: keep-existing\n      name: example-existing\n');
  for(let i=0;i<2;i++){const result=spawnSync(process.execPath,['scripts/install.mjs','--profile','desktop'],{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,DSH_HOME:home}});assert.equal(result.status,0,result.stderr||result.stdout);}
  const doc=yaml.load(fs.readFileSync(path.join(profile,'cordis.patch.yml'),'utf8')),entries=doc.flatMap(row=>row.insert||[]),ids=entries.map(e=>e.id);
  assert.ok(ids.includes('keep-existing'));for(const id of ['qq-launcher','mcp-snowluma','mcp-snowluma-host','mcp-web-search-safe','mcp-playwright','mcp-bridge-health','mcp-personal-core','preset-campus-summary'])assert.equal(ids.filter(value=>value===id).length,1,id);assert(!ids.includes('mcp-schnie-private-phi'));
  for(const e of entries){for(const arg of e.config?.args||[])if(path.isAbsolute(arg)&&/\.(?:mjs|js)$/.test(arg))assert.ok(fs.existsSync(arg),e.id+' missing entry');}
  for(const name of ['qq-agent-presets','qq-mode-console','qq-launcher'])assert.ok(fs.realpathSync(path.join(profile,'node_modules',name)).startsWith(root));
  const pkg=JSON.parse(fs.readFileSync(path.join(profile,'package.json')));assert.equal(new Set(pkg.dsh.profile.bundles).size,pkg.dsh.profile.bundles.length);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('Codex MCP code can initialize without any copied personal settings',async()=>{
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js');
 const client=new Client({name:'release-test',version:'1.0'});const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'plugins/qq-components/tool-codex-chat/src/mcp-server.mjs')],stderr:'pipe'});
 try{await client.connect(transport);const result=await client.listTools();for(const name of ['codex_chat_send','codex_chat_poll','codex_chat_status','codex_chat_time','codex_chat_cancel'])assert.ok(result.tools.some(t=>t.name===name));}finally{await client.close();}
});
test('Codex installer creates only fresh local settings and a new workspace, never copies a conversation',async()=>{
 const {install}=await import('../plugins/qq-components/tool-codex-chat/install.mjs');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'peer-install-')),profile=path.join(temp,'profile'),state=path.join(temp,'local-state');
 try{fs.mkdirSync(profile);fs.writeFileSync(path.join(profile,'cordis.patch.yml'),'[]\n');
  const first=install({profile,codexPath:process.execPath,stateDir:state});assert.equal(first.changed,true);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(state,'settings.json')))),['codexPath']);
  assert.ok(fs.existsSync(path.join(state,'workspace')));assert.equal(fs.existsSync(path.join(state,'state.json')),false);
  assert.equal(install({profile,codexPath:process.execPath,stateDir:state}).changed,false);
  assert.equal(install({profile,remove:true,stateDir:state}).changed,true);
  assert.deepEqual(yaml.load(fs.readFileSync(path.join(profile,'cordis.patch.yml'),'utf8')),[]);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('empty/default monitor stays idle; enabling a user target activates the generic scheduler',async()=>{
 const {createPlugin}=await import('../plugins/qq-components/life-campus-watch/index.js');
 for(const [config,expected] of [[{webWatchEnabled:false,watchUrls:[]},0],[{webWatchEnabled:true,watchUrls:['示例 | https://example.invalid/']},1]]){
  let count=0,state={};const plugin=createPlugin({root,config,state:{get:()=>state,set:value=>state={...state,...value}},registerTool(){},capabilities:{spawnCampusWatch(){count++;return true;}}});const now=Date.now();plugin.hooks.onTick({now});assert.equal(count,expected);plugin.hooks.onTick({now:now+60000});assert.equal(count,expected);plugin.hooks.onTick({now:now+1800000});assert.equal(count,expected*2);
 }
});
