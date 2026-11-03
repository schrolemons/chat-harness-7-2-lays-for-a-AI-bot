import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createProcessOwnership,probeProcess as nativeProbe} from './instance-ownership.mjs';
const fail=(code,message=code)=>Object.assign(Error(message),{code});
const live=child=>child?.pid&&child.exitCode===null&&child.signalCode===null;
const bounded=async(promise,ms)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('MONITOR_STOP_FAILED')),ms);})]);}finally{clearTimeout(timer);}};

/** An owned launch, never a search by port/profile. CDP is obtained only from
 * this child handle's stderr. No process tree killer or browser-discovery path.
 * Connected workers only disconnect; this owner alone may close its browser. */
export function createOwnedMonitorBrowser({root,instanceId,nonce,executablePath,env=process.env,spawnProcess=spawn,probeProcess=nativeProbe,updateProcess,
  connectBrowser=async endpoint=>(await import('puppeteer-core')).default.connect({browserWSEndpoint:endpoint,defaultViewport:null}),timeoutMs=10000}={}){
  if(!path.isAbsolute(root||'')||!path.isAbsolute(executablePath||'')||typeof updateProcess!=='function')throw fail('MONITOR_CONFIG_INVALID');
  let closed=false,uncertain=false,current=null,tail=Promise.resolve(),stopping;
  const entries=[];
  const status=()=>({uncertain,children:entries.map(e=>({kind:'monitor-browser',pid:e.child.pid,registered:!!e.record,running:!!live(e.child)}))});
  async function close(entry){
    if(!live(entry.child))return;
    if(!entry.browser)throw fail('MONITOR_STOP_FAILED','Owned browser has no verified CDP connection; lease retained');
    const exit=new Promise(resolve=>entry.child.once('exit',resolve));
    // This connected Browser came from our child's advertised endpoint, not a
    // configured/shared port. connect() has no launcher/process-tree fallback.
    await bounded(Promise.all([entry.browser.close(),exit]),timeoutMs);
  }
  async function openNow(headless){
    if(current){
      if(!live(current.child))throw fail('MONITOR_CHILD_EXITED');
      if(current.headless===headless)return {browserWSEndpoint:current.endpoint};
      await current.ownership.stop();current=null;
    }
    const profile=path.join(root,'state','owned-monitor-profile');
    for(const dir of [root,path.join(root,'state'),profile]){
      await fs.mkdir(dir,{recursive:true});const stat=await fs.lstat(dir);
      if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('MONITOR_PROFILE_INVALID');
    }
    const args=[...(headless?['--headless=new']:[]),'--no-proxy-server','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,
      '--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'];
    const child=spawnProcess(executablePath,args,{cwd:root,env,windowsHide:true,detached:false,stdio:['ignore','ignore','pipe']});
    const entry={child,headless,browser:null,endpoint:null,record:null,ownership:null};entries.push(entry);current=entry;
    entry.ownership=createProcessOwnership({instanceId,nonce,probeProcess,terminateProcess:()=>close(entry)});
    let output='';
    const endpoint=new Promise((resolve,reject)=>{
      const onData=chunk=>{output+=chunk.toString();const match=/DevTools listening on (ws:\/\/[^\s]+)/.exec(output);if(match){child.stderr.off('data',onData);try{const url=new URL(match[1]);if(url.hostname!=='127.0.0.1'||!/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(url.pathname))throw Error();resolve(url.href);}catch{reject(fail('MONITOR_ENDPOINT_INVALID'));}}else if(output.length>65536){child.stderr.off('data',onData);reject(fail('MONITOR_ENDPOINT_INVALID'));}};
      child.stderr?.on('data',onData);child.once('error',reject);child.once('exit',()=>reject(fail('MONITOR_CHILD_EXITED')));
    });endpoint.catch(()=>{});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    entry.record=await entry.ownership.registerSpawn(child,{commandPath:child.spawnfile});await updateProcess(entry.record);
    entry.endpoint=await bounded(endpoint,timeoutMs);
    entry.browser=await bounded(connectBrowser(entry.endpoint),timeoutMs);
    return {browserWSEndpoint:entry.endpoint};
  }
  function open(headless){
    if(closed)return Promise.reject(fail('MONITOR_CLOSING'));
    if(typeof headless!=='boolean')return Promise.reject(fail('MONITOR_ARGUMENT_INVALID'));
    const operation=tail.then(()=>openNow(headless)).catch(error=>{uncertain=true;throw error;});
    tail=operation.catch(()=>{});return operation;
  }
  function stop(){
    closed=true;
    return stopping??=(async()=>{await tail;for(const entry of [...entries].reverse()){
      if(!entry.record&&live(entry.child))throw fail('OWNERSHIP_UNCERTAIN');
      await entry.ownership.stop();
    }uncertain=false;})()
      .catch(error=>{uncertain=true;throw error;}).finally(()=>{stopping=null;});
  }
  return Object.freeze({open,stop,status,closeAdmission(){closed=true;}});
}
