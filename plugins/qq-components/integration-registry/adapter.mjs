// Trusted, installed bridge adapters only. Registration is not a permission grant.
const validKey=k=>/^(?:private|group):[1-9]\d*$/.test(String(k));
const validId=id=>/^[a-z][a-z0-9-]{0,79}$/.test(String(id));
export function createIntegrationRegistry(ctx){
 const runtime=ctx.runtime||(ctx.runtime={});runtime.adapters??=new Map();runtime.views??=new Map();
 const adapters=runtime.adapters,views=runtime.views;
 const active=a=>a&&a.alive()===true&&ctx.isPluginEnabled?.(a.id)!==false;
 const allowed=(a,key)=>validKey(key)&&a.keys.includes(key)&&active(a);
 const slot=(id,key)=>id+'\n'+key;
 return {
  register(spec={}){
   if(!validId(spec.id)||!Array.isArray(spec.keys)||!spec.keys.length||spec.keys.length>64||!spec.keys.every(validKey)||typeof spec.snapshot!=='function'||typeof spec.alive!=='function')return {ok:false,reason:'invalid_adapter'};
   const old=adapters.get(spec.id);if(old&&active(old)&&old.owner!==spec.owner)return {ok:false,reason:'duplicate_adapter'};
   if(old&&old.owner!==spec.owner)for(const key of views.keys())if(key.startsWith(spec.id+'\n'))views.delete(key);
   adapters.set(spec.id,{...spec,keys:[...new Set(spec.keys)]});return {ok:true};
  },
  unregister({id,owner}={}){if(adapters.get(id)?.owner!==owner)return false;adapters.delete(id);for(const key of views.keys())if(key.startsWith(id+'\n'))views.delete(key);return true;},
  list(){return [...adapters.values()].filter(active).map(a=>({id:a.id,keys:[...a.keys],actions:Object.keys(a.actions||{})}));},
  project(payload={}){
   const key=payload.key;if(!validKey(key))return [];
   const result=[];
   for(const a of adapters.values()){
    if(!allowed(a,key))continue;
    views.delete(slot(a.id,key));
    try{
     const state=a.snapshot({key});if(state?.then)throw Error('adapter snapshot must read local state synchronously');
     if(state==null)continue;const encoded=JSON.stringify(state);if(encoded.length>2000)throw Error('adapter state exceeds 2000 characters');
     const expression=ctx.callService?.('chatExpression','current',{key});
     const shared={key,at:Date.now(),role:{name:payload.roleName||'',source:'main-chat role-card',style:expression?.text||payload.moodState?.styleInstruction||''},memory:payload.persistentMemory?.text||'',mood:payload.moodState?{score:payload.moodState.score,mode:payload.moodState.mode}:null};
     views.set(slot(a.id,key),shared);if(views.size>256)views.delete(views.keys().next().value);
     result.push({id:a.id,state:JSON.parse(encoded),sharedContext:'current conversation role, memory and personality',actions:Object.keys(a.actions||{})});
    }catch(error){ctx.warn?.('适配状态未注入 '+a.id+'：'+error.message);}
   }
   return result;
  },
  context({id,key}={}){const a=adapters.get(id),v=views.get(slot(id,key));return allowed(a,key)&&v&&Date.now()-v.at<60000?structuredClone(v):null;},
  async invoke({id,key,action,args}={}){
   const a=adapters.get(id);if(!allowed(a,key)||typeof a.actions?.[action]!=='function')return {ok:false,status:'rejected',reason:'adapter_or_scope_unavailable'};
   const context=this.context({id,key});if(!context)return {ok:false,status:'rejected',reason:'fresh_context_required'};
   try{
    const r=await a.actions[action]({key,args,context});
    if(!allowed(a,key))return {ok:false,status:'unknown',reason:'adapter_unloaded'};
    if(!r||!['completed','queued','unknown','failed'].includes(r.status))return {ok:false,status:'unknown',reason:'execution_receipt_required'};
    return {...r,ok:r.status==='completed',status:r.status};
   }catch(error){return {ok:false,status:'failed',reason:String(error.message).slice(0,200)};}
  }
 };
}

// A user component can wrap a native room/game driver with this helper.
// It exposes no QQ/network/file capability and never creates another LLM call.
export function createBridgeAdapter(ctx,{keys,snapshot,actions={}}={}){
 const owner={},spec={id:ctx.id,owner,keys,snapshot,actions,alive:()=>ctx.isActive?.()!==false&&!ctx.signal?.aborted};
 const register=()=>ctx.callService('integrationContext','register',spec);
 return {hooks:{beforePrompt(){register();}},services:{integrationAdapter:{
  context:({key})=>{register();return ctx.callService('integrationContext','context',{id:ctx.id,key});},
  invoke:({key,action,args})=>{register();return ctx.callService('integrationContext','invoke',{id:ctx.id,key,action,args});}
 }}};
}
