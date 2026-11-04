import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {build} from 'esbuild';
import {createInstanceLauncher} from '../src/instance-launcher-host.mjs';
import {renderLauncherClient} from './build-dsh-bundle.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hostPackage=createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'),hostRequire=createRequire(hostPackage);
const load=name=>import(pathToFileURL(hostRequire.resolve('@deepseek-ai/'+name)).href);
const [{Context},{default:WebServer},Connection]=await Promise.all(['cordis','dsh-host-webserver','dsh-client-connection'].map(load));
const source=await fs.readFile(path.join(repo,'plugins/qq-launcher/lib/client.js'),'utf8');
const connectionSource=await fs.readFile(path.join(path.dirname(hostRequire.resolve('@deepseek-ai/dsh-client-connection/package.json')),'lib/client.browser.js'),'utf8');
const cordisBrowser=(await build({stdin:{contents:"import {Context} from '@deepseek-ai/cordis';window.fixtureRoot=new Context();",resolveDir:path.dirname(hostRequire.resolve('@deepseek-ai/cordis/package.json'))},bundle:true,platform:'browser',format:'iife',write:false})).outputFiles[0].text;
export async function browserHostFixture(t) {
  assert.equal(JSON.parse(await fs.readFile(hostPackage,'utf8')).version,'0.2.1-rc.2');
  for(const name of ['dsh-client-connection','dsh-host-webserver'])assert.equal(JSON.parse(await fs.readFile(hostRequire.resolve('@deepseek-ai/'+name+'/package.json'),'utf8')).version,'0.2.1-rc.2');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'launcher-native-browser-')),ctx=new Context(),handles=[],events=[],closers=[];
  const secrets=new Map();
  ctx.provide('credentials',{async modifyRecord(key,change) {const next=await change(secrets.get(key));if(next!==undefined)secrets.set(key,next);return secrets.get(key);}});
  await ctx.plugin(WebServer,{host:'127.0.0.1',port:0,compression:'none'});await ctx.plugin(Connection,{});
  let script='';
  ctx.webServer.registerFallback((req,res)=>{
    if(req.url.startsWith('/fixture.js')) {res.writeHead(200,{'content-type':'application/javascript'}).end(script);return;}
    if(new URL(req.url,'http://fixture').pathname!=='/') {res.writeHead(404).end();return;}
    if(!ctx.connection.authorizeIndex(req,res))return;
    res.writeHead(200,{'content-type':'text/html'}).end(ctx.webServer.renderIndex(`<!doctype html><html><head><meta charset="utf-8"><title>Synthetic launcher fixture</title></head><body style="margin:0;background:#f2f5f8;font:14px system-ui;color:#273449"><main style="padding:110px 24px"><h1>双实例启动器合成验收</h1><p>隔离测试预览 · 未安装到用户 DSH · 无真实 QQ / 模型调用</p><aside style="position:fixed;bottom:0;left:0;right:0;padding:4px;background:#e8eef5;font-size:11px;z-index:1300;text-align:center">合成测试预览 · 未安装到用户 DSH</aside><div id="external">普通 DSH 插件区域（保留）</div></main><script src="fixture.js"></script></body></html>`));
  });
  const origin=ctx.webServer.getOrigin();
  async function freePort(){const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
  async function enable(id,{port,wait=0}={}) {
    const root=path.join(dir,id);await fs.mkdir(root,{recursive:true});port??=await freePort();
    const descriptor={root,instanceId:id,label:id==='a'?'A 测试 bot':'B 测试 bot',bundleName:'synthetic-bot-'+id};
    await fs.writeFile(path.join(root,'config.json'),JSON.stringify({snowluma:{botUin:'123456789'},launcher:{ports:{dsh:'',console:await freePort(),snowHttp:3000,snowWs:3001,launcher:port,snowWebui:5099}}}));
    let state='stopped';
    const runtime={status:()=>({state}),async start(){events.push(id+':start');state='running';},async stop(){events.push(id+':stop');state='stopped';}};
    const handle=createInstanceLauncher(ctx,{descriptor,runtime,getDshOrigin:()=>ctx.webServer.getOrigin()},wait?{createHttpServer(fn){const server=http.createServer(fn),listen=server.listen.bind(server);server.listen=(...args)=>{setTimeout(()=>listen(...args),wait);return server;};return server;}}:{});
    handles.push(handle);await ctx.fiber.await();return {handle,descriptor,port};
  }
  function pageScript(ids=['a','b']) {
    script=`window.fixtureModules={};window.__ModuleLoader__={load(mod){window.fixtureModules[mod.id]=mod.factory(()=>({}));}};\n`+cordisBrowser+connectionSource+
      ids.map(id=>renderLauncherClient(source,'synthetic-bot-'+id)).join('\n')+
      `\n(async()=>{window.fixtureCtx=window.fixtureRoot;window.fixtureReset=()=>window.fixtureCtx.emit('connection/reset');await window.fixtureCtx.plugin(window.fixtureModules['@deepseek-ai/dsh-client-connection']);window.fixtureDispose={};window.fixtureMount=async(id)=>{const fiber=window.fixtureCtx.plugin(window.fixtureModules['synthetic-bot-'+id]);await fiber;window.fixtureDispose[id]=()=>fiber.dispose();};`+
      ids.map(id=>`await window.fixtureMount('${id}');`).join('\n')+`})().catch(error=>{throw error;});`;
  }
  t.after(async()=>{for(const close of closers)await close();for(const h of handles)await h.dispose();await ctx.fiber.dispose();assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true});});
  return {ctx,dir,origin,enable,events,freePort,pageScript,closers};
}

test('real pinned native Connection serves authenticated live discovery and synthetic browser A/B lifecycle', {timeout:60000}, async t=>{
 const f=await browserHostFixture(t),a=await f.enable('a');await a.handle.ready;f.pageScript();
 const request={type:'client-request',rpcId:'synthetic-auth-check',method:'list',payload:{}};
 assert.equal((await fetch(f.origin+'/qq-bot-discovery/list',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)})).status,401);
 assert.equal((await fetch(f.origin+'/qq-bot-discovery/list',{method:'POST',headers:{'content-type':'application/json',origin:'https://untrusted.example.test'},body:JSON.stringify(request)})).status,403);
 let browserPath=process.env.TEST_LAUNCHER_BROWSER||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>syncFs.existsSync(p));
 if(!browserPath){const {chromium}=await import('playwright');browserPath=chromium.executablePath();}
 assert.ok(syncFs.existsSync(browserPath),'a real Chromium executable is required');
 const browser=await puppeteer.launch({executablePath:browserPath,headless:true,userDataDir:path.join(f.dir,'chromium'),args:['--disable-background-networking','--no-first-run','--no-default-browser-check']});f.closers.push(()=>browser.close());
 const page=await browser.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.setViewport({width:1200,height:960});await page.goto(f.ctx.connection.authenticatedUrl(f.origin+'/'));
 await page.waitForSelector('#qq-launcher-a-button');
 assert.deepEqual(await page.evaluate(()=>Object.keys(window.__qqBotInstances)),['a']);
 await page.evaluate(()=>window.savedA=document.getElementById('qq-launcher-a-button'));
 const b=await f.enable('b',{wait:500});
 await page.waitForSelector('#qq-launcher-b-button');await b.handle.ready;
 assert.deepEqual(await page.evaluate(()=>Object.keys(window.__qqBotInstances)),['a'],'live B did not come from mutating the HTML snapshot');
 assert.equal(await page.evaluate(()=>window.savedA===document.getElementById('qq-launcher-a-button')),true);
 assert.equal(await page.$eval('[data-qq-bot-launchers]',node=>node.style.top),'8px');
 await page.evaluate(()=>{
  window.savedLateB=document.getElementById('qq-launcher-b-button');window.fixtureResizeCount=0;
  window.addEventListener('resize',()=>window.fixtureResizeCount++);
  // Installed preload waits for shell-overlay before appending this shadow host.
  const overlay=document.createElement('div');overlay.dataset.shellOverlay='';document.body.append(overlay);
  const host=document.createElement('div');host.dataset.windowsMenu='';const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML='<style>:host{position:fixed;top:0;left:var(--dsh-windows-menu-start,48px);height:var(--dsh-windows-titlebar-height,40px);display:flex;align-items:center;z-index:1100;font-family:system-ui;-webkit-app-region:no-drag}[role=menubar]{display:flex;gap:2px}button{height:28px;padding:0 10px;border:0;font:14px system-ui;background:transparent}</style><div role="menubar"><button>应用</button><button>编辑</button></div>';
  document.body.append(host);
 });
 const followsMenu=()=>{const menu=document.querySelector('[data-windows-menu]').getBoundingClientRect(),bar=document.querySelector('[data-qq-bot-launchers]').getBoundingClientRect();return Math.abs(bar.left-Math.round(menu.right+6))<1&&bar.top===0&&bar.height===40;};
 await page.waitForFunction(followsMenu,{timeout:6500});
 assert.equal(await page.evaluate(()=>window.fixtureResizeCount),0,'late menu placement must not require resize');
 await page.evaluate(()=>document.documentElement.style.setProperty('--dsh-windows-menu-start','32px'));
 await page.waitForFunction(followsMenu,{timeout:6500});
 assert.equal(await page.evaluate(()=>window.savedLateB===document.getElementById('qq-launcher-b-button')&&window.savedA===document.getElementById('qq-launcher-a-button')),true);
 assert.equal(await page.evaluate(()=>window.fixtureResizeCount),0,'geometry changes must not require resize');
 await page.click('#qq-launcher-a-button');await page.waitForFunction(()=>document.getElementById('qq-launcher-a-button').title.includes('正在等待 QQ 与 DSH 连接'));
 assert.deepEqual(f.events,['a:start']);
 await page.click('#qq-launcher-a-settings');await page.waitForFunction(()=>!document.getElementById('qq-launcher-a-settings-save').disabled);
 assert.equal(await page.$eval('#qq-launcher-a-port-dsh',node=>node.value),'');
 const nextPort=await f.freePort();await page.$eval('#qq-launcher-a-port-launcher',(node,value)=>node.value=String(value),nextPort);
 await page.click('#qq-launcher-a-settings-save');await page.waitForFunction(()=>document.getElementById('qq-launcher-a-settings-message').textContent.includes('已保存'));
 assert.equal(new URL(a.handle.address()).port,String(nextPort));
 assert.equal(JSON.parse(await fs.readFile(path.join(a.descriptor.root,'config.json'))).launcher.ports.dsh,'');
 const screenshotDir=process.env.TEST_UI_ARTIFACT_DIR||path.join(repo,'.superpowers/sdd/PLUGIN_WIRING_PLAN/task-6-artifacts');await fs.mkdir(screenshotDir,{recursive:true});
 await page.screenshot({path:path.join(screenshotDir,'dual-instance-settings-wide-fix1.png')});
 await page.setViewport({width:390,height:844});await page.screenshot({path:path.join(screenshotDir,'dual-instance-settings-narrow-fix1.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 assert.equal(await page.evaluate(()=>{const menu=document.querySelector('[data-windows-menu]').getBoundingClientRect(), bar=document.querySelector('[data-qq-bot-launchers]').getBoundingClientRect();return bar.top>=0&&bar.bottom<=menu.bottom&&bar.left>=menu.right&&bar.right<=innerWidth-140;}),true,'narrow controls stay in the real 40px titlebar lane');
 await page.reload();await page.waitForSelector('#qq-launcher-b-button');await page.waitForSelector('#qq-launcher-a-button');
 await page.click('#qq-launcher-a-settings');await page.click('#qq-launcher-a-stop');await page.waitForFunction(()=>document.getElementById('qq-launcher-a-button').title.endsWith('已停止'));assert.deepEqual(f.events,['a:start','a:stop']);
 await page.evaluate(()=>window.savedB=document.getElementById('qq-launcher-b-button'));
 await a.handle.dispose();await page.evaluate(async()=>{await window.fixtureDispose.a();delete window.fixtureDispose.a;});
 const enabled=await f.enable('a');await enabled.handle.ready;
 await page.evaluate(()=>window.fixtureMount('a'));await page.waitForSelector('#qq-launcher-a-button');
 assert.equal(await page.evaluate(()=>window.savedB===document.getElementById('qq-launcher-b-button')),true);
 assert.equal(await page.$eval('#external',node=>node.textContent),'普通 DSH 插件区域（保留）');
 await page.evaluate(()=>window.fixtureReset());await delay(80);
 const discovered=await page.evaluate(async()=>window.fixtureCtx.connection.rpc.call('/qq-bot-discovery','list',{}));
 assert.deepEqual(Object.keys(discovered.value).sort(),['a','b']);assert.deepEqual(Object.keys(discovered.value.a).sort(),['clientModuleId','generation','label','serviceUrl']);
 assert.equal(requests.some(url=>url.includes(':3199/')),false);
 assert.deepEqual(errors,[]);
 await enabled.handle.dispose();await b.handle.dispose();
 assert.equal((await page.evaluate(async()=>{const response=await fetch('qq-bot-discovery/list',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'after-last-removal',method:'list',payload:{}})});return response.status;})),404);
 console.log(JSON.stringify({carrier:'pinned native served web',screenshots:screenshotDir,events:f.events}));
});




if (process.env.TEST_DESKTOP_MAIN) test('installed Desktop custom-protocol forwarding carries real client discovery with native authentication', {timeout:20000}, async t=>{
 const {parse}=await import('acorn'),{default:vm}=await import('node:vm'),{createHash}=await import('node:crypto');
 const mainFile=process.env.TEST_DESKTOP_MAIN,desktopSource=await fs.readFile(mainFile,'utf8');
 assert.equal(createHash('sha256').update(desktopSource).digest('hex'),'6f3d1ddd1106371452c2204be6dfb2e5460a8e8259cdd05cdccb5387b3f9a85a');
 const tree=parse(desktopSource,{ecmaVersion:'latest',sourceType:'module'}),found={};
 function visit(node){if(!node||typeof node!=='object')return;
  if(node.type==='FunctionDeclaration'&&node.id?.name==='forwardWebRequest')found.forward=node;
  if(node.type==='VariableDeclaration'&&node.declarations.some(d=>['WITHHELD_RESPONSE_HEADERS','PLUGIN_BUNDLE_PATH'].includes(d.id?.name)))found[node.declarations[0].id.name]=node;
  if(node.type==='CallExpression'&&node.callee?.object?.name==='protocol'&&node.callee?.property?.name==='handle')found.protocol=node.arguments[1];
  for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
 }
 visit(tree);for(const key of ['forward','WITHHELD_RESPONSE_HEADERS','PLUGIN_BUNDLE_PATH','protocol'])assert.ok(found[key],key);
 const f=await browserHostFixture(t),a=await f.enable('a');await a.handle.ready;
 const auth=await fetch(f.ctx.connection.authenticatedUrl(f.origin+'/'),{redirect:'manual'});assert.equal(auth.status,303);
 const cookie=auth.headers.get('set-cookie').split(';')[0];
 const dependencies={URL,Headers,Request,Response,fetch,backend:{host:{}},hostUrl:f.origin+'/',hostCookie:cookie,
  serveWebDocument(){throw Error('Discovery must not enter the static document route');},join(){return '';},resources:{},app:{}};
 const helper=[found.WITHHELD_RESPONSE_HEADERS,found.PLUGIN_BUNDLE_PATH,found.forward].map(n=>desktopSource.slice(n.start,n.end)).join('\n');
 const protocol=vm.runInNewContext(helper+'\n('+desktopSource.slice(found.protocol.start,found.protocol.end)+')',dependencies);
 const installedConnection=await fs.readFile(path.resolve(path.dirname(mainFile),'../dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/client.browser.js'),'utf8');
 let client;const browserContext={window:{__ModuleLoader__:{load(m){client=m.factory(()=>({}));}}},URL,Headers,Request,Response,crypto:globalThis.crypto,AbortController,AbortSignal,console,setTimeout,clearTimeout};
 vm.runInNewContext(installedConnection,browserContext);
 const ctx={provide(name,value){this[name]=value;}};
 client.installConnection(ctx,{location:new URL('dsh-app://app/'),transport:{fetch:(input,init)=>protocol(new Request('dsh-app://app/'+input,{...init,headers:{...init.headers,origin:'dsh-app://app'}}))}});
 const first=await ctx.connection.rpc.call('/qq-bot-discovery','list',{});assert.equal(first.ok,true);assert.deepEqual(Object.keys(first.value),['a']);
 const b=await f.enable('b');await b.handle.ready;
 assert.deepEqual(Object.keys((await ctx.connection.rpc.call('/qq-bot-discovery','list',{})).value).sort(),['a','b']);
 const envelope={type:'client-request',rpcId:'synthetic-desktop',method:'list',payload:{}};
 const req=origin=>new Request('dsh-app://app/qq-bot-discovery/list',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(envelope)});
 assert.equal((await protocol(req('https://untrusted.example.test'))).status,403);
 dependencies.hostCookie='';assert.equal((await protocol(req('dsh-app://app'))).status,401);dependencies.hostCookie=cookie;
 dependencies.backend.host=undefined;assert.equal((await protocol(req('dsh-app://app'))).status,503);dependencies.backend.host={};
 await a.handle.dispose();assert.deepEqual(Object.keys((await ctx.connection.rpc.call('/qq-bot-discovery','list',{})).value),['b']);
 console.log('Installed Desktop exact protocol callback + forwardWebRequest + installed client RPC + native authenticated host: PASS; isolated function integration, no full Electron process/profile started.');
});
