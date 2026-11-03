import {randomUUID} from 'node:crypto';
import {ChildProcess} from 'node:child_process';
const fail=(code,message=code)=>Object.assign(Error(message),{code});
const text=v=>typeof v==='string'&&v.length>0&&v.length<=512;
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));

/** Host-only transport capability. Runtime binds only its exact registered
 * current ChildProcess; no HTTP endpoint, PID lookup or model tool grants it. */
export function bindOwnedRuntimeIpc({child,instanceId,generation,isActive,isOwned,reportCleanup,recordCreatedSession,spawnWorker,openMonitor}={}){
  if(!(child instanceof ChildProcess)||!child.connected||!text(instanceId)||!text(generation)||typeof isActive!=='function')throw fail('IPC_CAPABILITY_INVALID');
  let closed=false;const pending=new Set(),seen=new Set();
  const send=message=>new Promise(resolve=>{if(!child.connected)return resolve();try{child.send(message,()=>resolve());}catch{resolve();}});
  function onMessage(message){
    if(message?.type!=='qq-bridge:request')return;
    const task=(async()=>{
      const reply={type:'qq-bridge:reply',version:1,instanceId,generation,id:message.id};
      try{
        if(!exact(message,['type','version','instanceId','generation','id','method','params'])||message.version!==1||message.instanceId!==instanceId||message.generation!==generation||!text(message.id)||seen.has(message.id))throw fail('IPC_REQUEST_INVALID');
        seen.add(message.id);if(seen.size>4096)seen.delete(seen.values().next().value);
        const terminal=message.method==='worker.cleanup';
        if(terminal?(!isOwned?.()):closed||!isActive())throw fail('RUNTIME_CLOSING');
        if(terminal){
          const p=message.params;
          if(!exact(p,['clean','error'])||typeof p.clean!=='boolean'||typeof p.error!=='string'||p.error.length>2000||(p.clean&&p.error))throw fail('IPC_REQUEST_INVALID');
          if(typeof reportCleanup!=='function')throw fail('WORKER_UNSUPPORTED');
          reply.result=await reportCleanup({clean:p.clean,error:p.error});
        }else if(message.method==='session.recordCreated'){
          const p=message.params;
          if(!exact(p,['sessionId','workspaceId'])||!text(p.sessionId)||!text(p.workspaceId))throw fail('IPC_REQUEST_INVALID');
          if(typeof recordCreatedSession!=='function')throw fail('OWNERSHIP_UNSUPPORTED');
          reply.result=await recordCreatedSession({sessionId:p.sessionId,workspaceId:p.workspaceId});
        }else if(message.method==='worker.spawn'){
          if(!exact(message.params,['kind','args'])||typeof spawnWorker!=='function')throw fail('WORKER_UNSUPPORTED');
          reply.result=await spawnWorker(message.params.kind,message.params.args);
        }else if(message.method==='monitor.open'){
          if(!exact(message.params,['headless'])||typeof message.params.headless!=='boolean'||typeof openMonitor!=='function')throw fail('MONITOR_UNSUPPORTED');
          reply.result=await openMonitor(message.params.headless);
        }else throw fail('IPC_REQUEST_INVALID');
      }catch(error){reply.error={code:error.code||'IPC_OPERATION_FAILED',message:error.message};}
      await send(reply);
    })();
    pending.add(task);task.finally(()=>pending.delete(task));
  }
  child.on('message',onMessage);
  return Object.freeze({closeAdmission(){closed=true;},async drain(){await Promise.all([...pending]);},detach(){closed=true;child.off('message',onMessage);}});
}

/** Child-side client used only when an owned runtime supplied a built-in IPC
 * channel. Missing/disconnected transport reports uncertainty to the session
 * adapter, which preserves the already-created ID. No create retry occurs. */
export function createRuntimeIpcClient({transport=process,instanceId=process.env.QQ_BRIDGE_INSTANCE_ID,generation=process.env.QQ_BRIDGE_RUNTIME_GENERATION,timeoutMs=10000,onShutdown}={}){
  const pending=new Map();let closed=false,shutdown;
  const shut=()=>{closed=true;shutdown??=Promise.resolve().then(()=>onShutdown?.()).catch(()=>{});};
  const rejectAll=()=>{closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(fail('IPC_DISCONNECTED'));}pending.clear();};
  function onMessage(m){
    if(m?.instanceId!==instanceId||m?.generation!==generation||m?.version!==1)return;
    if(m.type==='qq-bridge:shutdown'){
      shut();return;
    }
    if(m.type!=='qq-bridge:reply')return;
    const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);
    m.error?p.reject(fail(m.error.code||'IPC_OPERATION_FAILED',m.error.message)):p.resolve(m.result);
  }
  const disconnected=()=>{rejectAll();shut();};
  if(transport.connected&&text(instanceId)&&text(generation)){transport.on('message',onMessage);transport.on('disconnect',disconnected);}
  const request=(method,params)=>new Promise((resolve,reject)=>{
    if((closed&&method!=='worker.cleanup')||!transport.connected||typeof transport.send!=='function'||!text(instanceId)||!text(generation))return reject(fail('IPC_UNAVAILABLE'));
    const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(fail('IPC_TIMEOUT'));},timeoutMs);
    pending.set(id,{resolve,reject,timer});
    const failed=error=>{if(!error)return;const p=pending.get(id);if(p){pending.delete(id);clearTimeout(timer);reject(fail('IPC_DISCONNECTED'));}};
    try{transport.send({type:'qq-bridge:request',version:1,instanceId,generation,id,method,params},failed);}catch(error){failed(error);}
  });
  return Object.freeze({reportCleanup:r=>request('worker.cleanup',r),recordCreatedSession:r=>request('session.recordCreated',r),spawnWorker:(kind,args)=>request('worker.spawn',{kind,args}),openMonitor:headless=>request('monitor.open',{headless}),
    dispose(){rejectAll();transport.off('message',onMessage);transport.off('disconnect',disconnected);}});
}
