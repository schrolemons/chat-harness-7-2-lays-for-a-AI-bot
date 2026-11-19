import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const api=await import('../src/owned-monitor-browser.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
async function fixture(t,extra={}){
 assert.equal(typeof api.createOwnedMonitorBrowser,'function');
 const root=extra.root??await fs.mkdtemp(path.join(os.tmpdir(),'owned-monitor-')),children=[],records=[],live=new Map();
 const launchArgs=[];
 const spawnProcess=(file,args,opts)=>{
  launchArgs.push(args);
  const child=spawn(process.execPath,['-e',`console.error('DevTools listening on ws://127.0.0.1:23456/devtools/browser/fixture');setInterval(()=>{},1000);`,'--',...args],opts);
  children.push(child);live.set(child.pid,{pid:child.pid,parentPid:process.pid,startTime:String(child.pid),executablePath:process.execPath});child.on('exit',()=>live.delete(child.pid));return child;
 };
 const monitor=api.createOwnedMonitorBrowser({root,instanceId:'fixture',nonce:'nonce',executablePath:process.execPath,spawnProcess,
  probeProcess:async pid=>live.get(pid)||null,updateProcess:r=>records.push(r),timeoutMs:5000,
  connectBrowser:async()=>({close:async()=>{const child=children.at(-1),end=once(child,'exit');child.kill();await end;}}),...extra});
 t.after(async()=>{await monitor.stop().catch(()=>{});for(const c of children)if(c.exitCode===null&&c.signalCode===null){const end=once(c,'exit');c.kill();await end;}if(!extra.root)await fs.rm(root,{recursive:true,force:true});});
 return {root,monitor,children,records,live,launchArgs};
}
test('browser capability is created once per mode, registered before endpoint use and stops only its child',async t=>{
 const external=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});await once(external,'spawn');t.after(async()=>{const end=once(external,'exit');external.kill();await end;});
 const f=await fixture(t);assert.match((await f.monitor.open(true)).browserWSEndpoint,/devtools\/browser\/fixture/);assert.equal(f.records.length,1);
 await f.monitor.open(true);assert.equal(f.children.length,1);await f.monitor.open(false);assert.equal(f.children.length,2);assert.ok(f.children[0].exitCode!==null||f.children[0].signalCode!==null);
 const profiles=f.launchArgs.map(args=>args.find(arg=>arg.startsWith('--user-data-dir=')));
 assert.equal(new Set(profiles).size,2);
 assert.ok(profiles.every(arg=>arg.startsWith('--user-data-dir='+path.join(f.root,'state','owned-monitor-'))));
 await f.monitor.stop();assert.equal(f.children[1].signalCode,'SIGTERM');assert.equal(external.exitCode,null);await assert.rejects(f.monitor.open(true),/MONITOR_CLOSING/);
});
test('browser close failure retains uncertainty and never claims stopped',async t=>{
 let closeCount=0;const f=await fixture(t,{connectBrowser:async()=>({close:async()=>{closeCount++;throw Error('close failed');}})});
 await f.monitor.open(true);await assert.rejects(f.monitor.stop(),/close failed/);assert.equal(f.monitor.status().uncertain,true);assert.equal(f.children[0].exitCode,null);assert.equal(closeCount,1);
});

test('an exact browser child that exits during admission leaves no permanent shutdown uncertainty',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'monitor-exit-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let child;
 const monitor=api.createOwnedMonitorBrowser({root,instanceId:'fixture',nonce:'dead-browser',executablePath:process.execPath,
  spawnProcess:(_file,_args,options)=>{child=spawn(process.execPath,['-e','process.exit(0)'],options);return child;},
  probeProcess:async()=>{if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');return null;},updateProcess:async()=>{},timeoutMs:1000});
 await assert.rejects(monitor.open(true),/does not belong|MONITOR_CHILD_EXITED/);assert.equal(monitor.status().uncertain,false);await monitor.stop();
});
test('browser request racing disable drains its registration and refuses later admission',async t=>{
 let entered,release;const at=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let f;
 f=await fixture(t,{updateProcess:async()=>{entered();await gate;}});
 const opening=f.monitor.open(true);await at;let stopped=false;const stopping=f.monitor.stop().then(()=>stopped=true);await new Promise(r=>setImmediate(r));assert.equal(stopped,false);await assert.rejects(f.monitor.open(true),/MONITOR_CLOSING/);release();await opening;await stopping;
 assert.equal(f.children.every(c=>c.exitCode!==null||c.signalCode!==null),true);
});

test('real isolated headless browsers close through owned capability while the other browser stays usable', {skip:!process.env.TEST_OWNED_BROWSER_PATH,timeout:60000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'owned-browser-native-')),owners=[];
 t.after(async()=>{for(const owner of owners)await owner.stop();await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});});
 for(const id of ['first','second'])owners.push(api.createOwnedMonitorBrowser({root,instanceId:id,nonce:id,executablePath:process.env.TEST_OWNED_BROWSER_PATH,updateProcess:async()=>{},timeoutMs:15000}));
 const [a,b]=await Promise.all(owners.map(owner=>owner.open(true)));
 assert.notEqual(a.browserWSEndpoint,b.browserWSEndpoint);
 const puppeteer=(await import('puppeteer-core')).default;
 const browser=await puppeteer.connect({browserWSEndpoint:b.browserWSEndpoint});
 try{await owners[0].stop();const page=await browser.newPage();await page.goto('about:blank');assert.equal(await page.evaluate(()=>2+3),5);await page.close();assert.equal(owners[0].status().children[0].running,false);assert.equal(owners[1].status().children[0].running,true);}finally{await browser.disconnect();}
});

test('visible sign-in preserves its dedicated profile across launches without sharing headless state',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'owned-monitor-'));
 const f=await fixture(t,{root});
 const restarted=await fixture(t,{root});
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const profile=path.join(root,'state','owned-monitor-login-profile');
 const userChoice=path.join(profile,'synthetic-profile-choice.txt');
 const launchedProfile=args=>args.find(arg=>arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);

 await f.monitor.open(false);
 assert.equal(launchedProfile(f.launchArgs[0]),profile);
 assert.ok(!f.launchArgs[0].includes('--disable-background-networking'));
 await fs.writeFile(userChoice,'browser-owned profile preference');
 await f.monitor.open(true);
 const headless=launchedProfile(f.launchArgs[1]);
 assert.notEqual(headless,profile);
 assert.ok(f.launchArgs[1].includes('--disable-background-networking'));
 await f.monitor.open(false);
 assert.equal(launchedProfile(f.launchArgs[2]),profile);
 assert.equal(await fs.readFile(userChoice,'utf8'),'browser-owned profile preference');
 await assert.rejects(fs.stat(headless),{code:'ENOENT'});

 await f.monitor.stop();
 await restarted.monitor.open(false);
 assert.equal(launchedProfile(restarted.launchArgs[0]),profile);
 assert.equal(await fs.readFile(userChoice,'utf8'),'browser-owned profile preference');
});

test('two owners cannot launch a visible browser into the same profile',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'owned-monitor-'));
 const first=await fixture(t,{root});
 const second=await fixture(t,{root});
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await first.monitor.open(false);
 await assert.rejects(second.monitor.open(false),{code:'MONITOR_PROFILE_BUSY'});
 assert.equal(second.children.length,0);
 assert.equal(first.monitor.status().children[0].running,true);
 await first.monitor.stop();
 await second.monitor.open(false);
 assert.equal(second.children.length,1);
});
