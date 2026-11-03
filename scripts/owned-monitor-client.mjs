import path from 'node:path';
import {createRuntimeIpcClient} from '../src/instance-runtime-ipc.mjs';
import {loadInstanceSessionPolicy} from '../src/instance-session-policy.mjs';

/** Null is explicit legacy compatibility. An announced instance without its
 * real parent IPC never falls back to detached workers or shared browser ports. */
export function createOwnedMonitorClient({root,kind,onShutdown}={}){
  if(!process.env.QQ_BRIDGE_INSTANCE_ID)return null;
  const policy=loadInstanceSessionPolicy({root});
  if(!policy.active||process.env.QQ_BRIDGE_WORKER_KIND!==kind||!process.connected
    ||path.resolve(process.env.QQ_BRIDGE_ROOT||'')!==path.resolve(root))throw Error('OWNED_MONITOR_REQUIRED');
  const browsers=new Set();let disposed=false;
  const client=createRuntimeIpcClient({onShutdown:async()=>{
    await onShutdown?.();
    for(const browser of browsers)await browser.disconnect();
    process.exit(0);
  }});
  return Object.freeze({
    async connect(headless){
      if(disposed)throw Error('MONITOR_CLOSING');
      const {browserWSEndpoint}=await client.openMonitor(headless);
      const browser=await (await import('puppeteer-core')).default.connect({browserWSEndpoint,defaultViewport:null});
      if(disposed){await browser.disconnect();throw Error('MONITOR_CLOSING');}
      browsers.add(browser);return browser;
    },
    spawn:(worker,args=[])=>client.spawnWorker(worker,args),
    async dispose(){disposed=true;for(const browser of browsers)await browser.disconnect();browsers.clear();client.dispose();if(process.connected)process.disconnect();}
  });
}
