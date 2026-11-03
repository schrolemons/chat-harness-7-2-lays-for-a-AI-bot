import {pathToFileURL} from 'node:url';
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import net from 'node:net';import {spawn} from 'node:child_process';import {once} from 'node:events';import {parse} from 'acorn';
import {installManagedSnow,SNOW_RELEASE} from './install-managed-snow.mjs';
import {initializeManifest} from '../src/instance-manifest.mjs';
import {readInstanceDescriptor} from '../src/instance-descriptor.mjs';
import {createInstanceRuntime} from '../src/instance-runtime.mjs';
import {scopeSnowSource} from './snow-bootstrap.mjs';

/** Test-only replacement of startup, never installed as production code.
 * Original network adapters/config/WebUI remain byte-for-byte vendor source.
 * All QQ entry classes + main are replaced with throwing sentinels. Updater
 * startup is removed. A preload forbids subprocess execution and pipe access. */
function noQqEntry(source){
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),edits=[],blocked=['HookManager','BridgeManager','QqHookClient'];
 for(const name of blocked){const nodes=ast.body.flatMap(n=>n.type==='VariableDeclaration'?n.declarations:[]).filter(n=>n.id.name===name);assert.equal(nodes.length,1,`unique ${name}`);edits.push({start:nodes[0].init.start,end:nodes[0].init.end,value:`class { constructor(){throw Error('NO_QQ_TEST_FORBIDDEN_${name}')} }`});}
 const main=ast.body.filter(n=>n.type==='FunctionDeclaration'&&n.id.name==='main');assert.equal(main.length,1);edits.push({start:main[0].start,end:main[0].end,value:"function main(){throw Error('NO_QQ_TEST_MAIN_FORBIDDEN')}"});
 const start=ast.body.filter(n=>n.type==='IfStatement'&&source.slice(n.start,n.start+80).startsWith('if (isMessageStoreMigrationWorkerData(workerData))'));assert.equal(start.length,1);edits.push({start:start[0].start,end:start[0].end,value:''});
 for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.value+source.slice(edit.end);
 return source+`
const fixtureConfig=loadOneBotConfig('123456789');
const fixtureContext={uin:'123456789',api:{isAcceptingActions:true,isStreamAction:()=>false,handle:()=>{throw Error('NO_QQ_ACTION')}},buildLifecycleEvent:()=>({}),buildHeartbeatEvent:()=>({}),handleAction:()=>{throw Error('NO_QQ_ACTION')}};
const fixtureHttp=new HttpServerAdapter('http-default',fixtureConfig.networks.httpServers[0],fixtureContext);
const fixtureWs=new WsServerAdapter('ws-default',fixtureConfig.networks.wsServers[0],fixtureContext);
await fixtureHttp.open();await fixtureWs.open();
const fixtureRuntime=loadRuntimeConfig();
const forbidden=()=>{throw Error('NO_QQ_TEST_OPERATION_FORBIDDEN')};
const fixtureUi=await initWebUI(fixtureRuntime.webuiPort,{getInstances:()=>[],getConnectionStatuses:()=>[],getInstance:()=>null},{listProcesses:async()=>[],loadProcess:forbidden,unloadProcess:forbidden,refreshProcess:forbidden},{getRecent:()=>[],testSend:forbidden},{host:fixtureRuntime.webuiHost,tlsEnabled:false,updateRoot});
process.on('message',async message=>{if(message==='shutdown'){await fixtureHttp.close();await fixtureWs.close();await fixtureUi.stop();await closeLogger();process.exit(0);}});
process.send({type:'fixture-ready',http:fixtureConfig.networks.httpServers[0].port,ws:fixtureConfig.networks.wsServers[0].port,webui:fixtureRuntime.webuiPort});
`;
}
const guard=`import cp from 'node:child_process';import net from 'node:net';import {syncBuiltinESMExports} from 'node:module';
const forbidden=()=>{throw Error('NO_QQ_TEST_SUBPROCESS_FORBIDDEN')};process.dlopen=forbidden;for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=forbidden;
const connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){const first=args[0];if(typeof first==='string'||first?.path||Array.isArray(first)&&first[0]?.path)throw Error('NO_QQ_TEST_PIPE_FORBIDDEN');return connect.apply(this,args);};syncBuiltinESMExports();`;
async function freePorts(){const servers=[];for(let i=0;i<6;i++){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');servers.push(s);}const ports=servers.map(s=>s.address().port);await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));return Object.fromEntries(['dsh','console','snowHttp','snowWs','launcher','snowWebui'].map((k,i)=>[k,ports[i]]));}

test('real official vendor network factories bind configured ports with every QQ discovery and injection path excluded', {skip:!process.env.TEST_SNOW_ARTIFACT,timeout:60000},async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'managed-listeners-')),root=path.join(base,'bot');await fs.mkdir(root);
 let descriptor={version:1,root,instanceId:'test-bot',label:'Test bot',dshHome:path.join(base,'host'),profile:'fixture',bundleName:'fixture-bot',entryId:'fixture-bot',settingsNamespace:'fixture-bot',presetIdMap:{}};
 await fs.writeFile(path.join(root,'.qq-bridge-instance.json'),JSON.stringify(descriptor));await initializeManifest(root,descriptor);descriptor=await readInstanceDescriptor(root);
 const installed=await installManagedSnow({descriptor,artifact:process.env.TEST_SNOW_ARTIFACT,expectedDigest:SNOW_RELEASE.sha256});
 const ports=await freePorts();await fs.writeFile(path.join(root,'config.json'),JSON.stringify({launcher:{ports},snowluma:{botUin:'123456789',accessToken:'fixture-owned-token'}}));
 await fs.mkdir(path.join(root,'src'));await fs.mkdir(path.join(root,'scripts'));await fs.writeFile(path.join(root,'src','bridge.js'),'');await fs.writeFile(path.join(root,'scripts','snow-bootstrap.mjs'),'');
 const identities=new Map([[process.pid,{pid:process.pid,parentPid:1,startTime:'test-owner',executablePath:process.execPath}]]);let snowOptions;const sleepers=[];
 const runtime=createInstanceRuntime({descriptor,snowHome:installed.snowHome,probePort:async()=>false,probeProcess:async pid=>identities.get(pid)||null,spawnProcess:(file,args,options)=>{
   snowOptions??=options;const child=spawn(process.execPath,['-e',"process.on('message',m=>{if(m==='shutdown'||m.type==='qq-bridge:shutdown')process.exit(0)});setInterval(()=>{},1000)",'--',...args],options);sleepers.push(child);identities.set(child.pid,{pid:child.pid,parentPid:process.pid,startTime:String(child.pid),executablePath:process.execPath});child.on('exit',()=>identities.delete(child.pid));return child;
 }});
 let child;
 t.after(async()=>{await runtime.stop().catch(()=>{});for(const c of [child,...sleepers])if(c&&c.exitCode===null&&c.signalCode===null){const end=once(c,'exit');c.kill();await end;}await fs.rm(base,{recursive:true,force:true,maxRetries:10,retryDelay:200});});
 await runtime.start();await runtime.stop();
 const original=await fs.readFile(path.join(installed.snowHome,'index.mjs'),'utf8');
 assert.doesNotThrow(()=>scopeSnowSource(original,'123456789',new URL('./snow-target-account.mjs',import.meta.url).href));
 const entry=path.join(installed.snowHome,'fixture-listeners.mjs'),preload=path.join(installed.snowHome,'fixture-no-qq-guard.mjs');
 await fs.writeFile(entry,noQqEntry(original));await fs.writeFile(preload,guard);
 const env={...snowOptions.env};delete env.SNOWLUMA_BRIDGE_ENTRY;delete env.SNOWLUMA_BRIDGE_UIN;
 child=spawn(path.join(installed.snowHome,'node.exe'),['--import',pathToFileURL(preload).href,entry],{cwd:installed.snowHome,env,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
 let stderr='';child.stderr.on('data',chunk=>stderr+=chunk.toString());
 const ready=await Promise.race([once(child,'message').then(([m])=>m),once(child,'exit').then(([code])=>{throw Error(`vendor fixture exited ${code}: ${stderr.slice(-2000)}`);})]);
 assert.deepEqual(ready,{type:'fixture-ready',http:ports.snowHttp,ws:ports.snowWs,webui:ports.snowWebui});
 const response=await fetch(`http://127.0.0.1:${ports.snowHttp}/get_status`);assert.equal(response.status,401);
 const ui=await fetch(`http://127.0.0.1:${ports.snowWebui}/`);assert.equal(ui.status,200);
 const ws=net.connect({host:'127.0.0.1',port:ports.snowWs});await once(ws,'connect');ws.destroy();
 await assert.rejects(fs.access(path.join(installed.snowHome,'config','consent.json')),{code:'ENOENT'});
 const end=once(child,'exit');child.send('shutdown');assert.equal((await end)[0],0);
 for(const port of [ports.snowHttp,ports.snowWs,ports.snowWebui])await new Promise((resolve,reject)=>{const socket=net.connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();reject(Error('listener survived shutdown'));});socket.once('error',e=>e.code==='ECONNREFUSED'?resolve():reject(e));});
});
