import {createHash} from 'node:crypto';
import {createModelCatalogReader,validateCatalogSelection,validateCatalogRange} from '../../plugins/qq-components/obs-cost-policy/catalog.mjs';
import {normalizeModelPolicy,selectCostPolicy} from '../../plugins/qq-components/obs-cost-policy/policy.mjs';
export const modelPolicyRevision=config=>createHash('sha256').update(JSON.stringify(normalizeModelPolicy(config))).digest('hex');
export function createModelPolicyController({fetchCatalog,fetchPresets,readPolicy,savePolicy,synchronize,canonicalPreset=id=>id}){
 const catalog=createModelCatalogReader(fetchCatalog);let saves=Promise.resolve();
 async function presetList(){
  const list=await fetchPresets(),byId=new Map();
  for(const p of list){const id=canonicalPreset(p.id);byId.set(id,{id,name:p.name||id,description:p.description||'',runtimeId:p.id,available:!p.broken});}
  for(const id of Object.keys(readPolicy().presets))if(!byId.has(id))byId.set(id,{id,name:id,available:false});
  return [...byId.values()];
 }
 async function save(body){
  if(!body||!['global','conversation','task','preset'].includes(body.scope))throw Object.assign(Error('模型配置用途无效'),{status:400});
  const current=normalizeModelPolicy(readPolicy());
  if(typeof body.revision!=='string'||body.revision!==modelPolicyRevision(current))throw Object.assign(Error('模型配置已被其他操作更新，请重新读取后再保存'),{status:409});
  const id=body.scope==='preset'?body.presetId:null;
  if(body.scope==='preset'){
   if(typeof id!=='string'||['__proto__','constructor','prototype'].includes(id)||!id||id!==id.trim())throw Object.assign(Error('预设 ID 无效'),{status:400});
   if(body.selection!==null){
    let presets;try{presets=await presetList();}catch{throw Object.assign(Error('无法读取 DSH 预设目录，配置未保存'),{status:503});}
    if(!presets.some(p=>p.id===id&&p.available))throw Object.assign(Error('预设不在 DSH 当前可用目录中'),{status:400});
   }
  }
  let selection;
  if(body.scope==='preset'&&body.selection===null)delete current.presets[id];
  else{
   let directory;try{directory=await catalog();}catch{throw Object.assign(Error('无法读取 DSH 模型目录，配置未保存'),{status:503});}
   try{selection=id==='qq-task-worker'?validateCatalogRange(body.selection,directory):validateCatalogSelection(body.selection,directory);}catch(error){throw Object.assign(error,{status:400});}
   if(body.scope==='global'){
    current.conversation={...selection};current.task={...selection};
   }else if(id)current.presets[id]=selection;else current[body.scope]=selection;
  }
  if(body.revision!==modelPolicyRevision(readPolicy()))throw Object.assign(Error('模型配置在校验期间发生变化，请重新读取'),{status:409});
  const config=normalizeModelPolicy(current),result=await savePolicy(config);
  if(!result.ok)throw Object.assign(Error(result.error||'模型配置保存失败'),{status:400});
  let sync;try{sync=await synchronize({...(body.scope==='global'||body.scope==='conversation'?{globalDefault:config.conversation}:{})});}catch(error){sync={ok:false,error:error.message};}
  return {ok:sync?.ok===true,saved:true,config,revision:modelPolicyRevision(config),sync,error:sync?.ok===true?undefined:'模型配置已保存，但部分会话同步失败；请重新读取并检查同步结果'};
 }
 return {catalog,async route({req,url,readBody,sendJson}){
  if(req.method==='GET'&&url.pathname==='/api/dsh/models'){
   try{sendJson({ok:true,...await catalog(),source:'dsh'});}catch{sendJson({ok:false,error:'无法读取 DSH 模型目录，请刷新重试'},503);}return true;
  }
  if(url.pathname==='/api/presets/model-policy'&&req.method==='GET'){
   try{const presets=await presetList(),config=normalizeModelPolicy(readPolicy());sendJson({ok:true,config,revision:modelPolicyRevision(config),presets,globalSideEffect:false,supportsGlobalDefault:true});}
   catch{sendJson({ok:false,error:'无法读取预设模型设置或 DSH 预设目录'},503);}return true;
  }
  if(url.pathname==='/api/presets/model-policy'&&req.method==='POST'){
   try{const body=await readBody(),work=saves.then(()=>save(body));saves=work.catch(()=>{});const result=await work;sendJson(result,result.ok?200:409);}
   catch(error){sendJson({ok:false,error:error.message},error.status||400);}return true;
  }
  if(req.method==='GET'&&url.pathname==='/api/dsh/model'){
   try{const config=readPolicy(),current=selectCostPolicy(config,{purpose:'conversation'});sendJson({...current,policySource:'preset-overview',default:config.conversation.effort,globalSideEffect:false});}
   catch{sendJson({ok:false,error:'模型配置不可读'},503);}return true;
  }
  if(req.method==='POST'&&url.pathname==='/api/dsh/effort'){
   sendJson({ok:false,error:'此入口已停用，请在 E 层预设总览分别设置对话、任务和预设模型'},410);return true;
  }
  return false;
 }};
}
