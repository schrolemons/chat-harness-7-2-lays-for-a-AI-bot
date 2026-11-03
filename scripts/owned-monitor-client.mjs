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
  const browsers=new Set();let disposed=false,finishing;const failures=[];
  const noteCleanupFailure=error=>{failures.push(String(error?.message||error));};
  const cleanup=async operation=>{try{return await operation();}catch(error){noteCleanupFailure(error);throw error;}};
  const client=createRuntimeIpcClient({onShutdown:async()=>{await finish();process.exit(failures.length?1:0);}});
  function finish(){
    disposed=true;
    return finishing??=(async()=>{
      try{await onShutdown?.();}catch(error){noteCleanupFailure(error);}
      for(const browser of browsers)try{await browser.disconnect();}catch(error){noteCleanupFailure(error);}
      browsers.clear();
      try{await client.reportCleanup({clean:failures.length===0,error:failures.join('; ').slice(0,2000)});}
      catch(error){noteCleanupFailure(error);}
      finally{if(failures.length)process.exitCode=1;client.dispose();if(process.connected)process.disconnect();}
    })();
  }
  const admitting=()=>{if(disposed||failures.length)throw Error('MONITOR_CLOSING');};
  return Object.freeze({
    async connect(headless){
      admitting();
      const {browserWSEndpoint}=await client.openMonitor(headless);
      const browser=await (await import('puppeteer-core')).default.connect({browserWSEndpoint,defaultViewport:null});
      if(disposed){await browser.disconnect();throw Error('MONITOR_CLOSING');}
      browsers.add(browser);return browser;
    },
    spawn:(worker,args=[])=>{admitting();return client.spawnWorker(worker,args);},
    recordCreatedSession:kind==='campus-watch'?record=>{admitting();return client.recordCreatedSession(record);}:undefined,
    cleanup,noteCleanupFailure,dispose:finish
  });
}
