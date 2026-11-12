import fs from 'node:fs';import path from 'node:path';
const legacyDefault={provider:'deepseek-official',model:'deepseek-flash',effort:'low'};
export const COST_POLICY_DEFAULTS=Object.freeze({conversation:legacyDefault,task:legacyDefault,presets:{}});
const forbidden=new Set(['__proto__','constructor','prototype']);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function validateModelSelection(value){
 if(!object(value)||Object.keys(value).some(key=>!['provider','model','effort'].includes(key)))throw Error('模型选择必须包含 provider、model、effort');
 const out={};for(const key of ['provider','model','effort']){
  const text=value[key];if(typeof text!=='string'||text.length>512||text!==text.trim()||/[\u0000-\u001f\u007f]/.test(text)||(key!=='effort'&&!text))throw Error('模型选择参数无效：'+key);
  out[key]=text;
 }return out;
}
export function normalizeModelPolicy(raw={}){
 if(!object(raw))throw Error('模型配置必须是对象');
 if(!Object.hasOwn(raw,'conversation')&&!Object.hasOwn(raw,'task')&&!Object.hasOwn(raw,'presets')){
  // Read-only migration: ordinary tasks used the old baseline, not the keyword upgrade.
  const previous=validateModelSelection({provider:raw.defaultProvider??legacyDefault.provider,model:raw.defaultModel??legacyDefault.model,effort:raw.defaultEffort??legacyDefault.effort});
  return {conversation:{...previous},task:{...previous},presets:{}};
 }
 const conversation=validateModelSelection(raw.conversation),task=validateModelSelection(raw.task);
 if(!object(raw.presets))throw Error('预设模型配置必须是对象');
 const presets={};for(const id of Object.keys(raw.presets).sort()){
  if(!id||id!==id.trim()||id.length>512||forbidden.has(id)||/[\u0000-\u001f\u007f]/.test(id))throw Error('预设 ID 无效');
  presets[id]=id==='qq-task-worker'?validateTaskModelRange(raw.presets[id]):validateModelSelection(raw.presets[id]);
 }
 return {conversation,task,presets};
}
export function validateTaskModelRange(value){
 // Migrate an existing fixed worker setting into a one-choice range.
 if(object(value)&&!Object.hasOwn(value,'allowed')){const s=validateModelSelection(value);return {allowed:[{provider:s.provider,model:s.model,efforts:[s.effort]}]};}
 if(!object(value)||Object.keys(value).some(k=>k!=='allowed')||!Array.isArray(value.allowed)||!value.allowed.length)throw Error('任务范围至少需要一个模型');
 const seen=new Set();
 const allowed=value.allowed.map(item=>{
  if(!object(item)||Object.keys(item).some(k=>!['provider','model','efforts'].includes(k))||!Array.isArray(item.efforts)||!item.efforts.length)throw Error('每个任务模型至少需要一个思考档位');
  const efforts=item.efforts.map(e=>validateModelSelection({provider:item.provider,model:item.model,effort:e}).effort);
  const key=JSON.stringify([item.provider,item.model]);if(seen.has(key)||new Set(efforts).size!==efforts.length)throw Error('任务范围不能重复');seen.add(key);
  return {provider:item.provider,model:item.model,efforts};
 });return {allowed};
}
export function taskModelRange(raw){const c=normalizeModelPolicy(raw);return c.presets['qq-task-worker']||validateTaskModelRange(c.task);}
export function selectTaskModel(raw,selection){
 const range=taskModelRange(raw),choices=range.allowed.flatMap(({provider,model,efforts})=>efforts.map(effort=>({provider,model,effort})));
 if(selection===undefined&&choices.length===1)return choices[0];
 if(selection===undefined)throw Error('请先用 qq_task_models 查询范围，再通过 modelSelection 指定任务模型和思考档位');
 const s=validateModelSelection(selection);
 if(!choices.some(c=>c.provider===s.provider&&c.model===s.model&&c.effort===s.effort))throw Error('任务模型或思考档位超出允许范围，请用 qq_task_models 重新选择');
 return s;
}
export function selectCostPolicy(raw={},payload={}){
 const config=normalizeModelPolicy(raw);
 const purpose=payload.purpose??(payload.task!==undefined||['slangLearn','webSummary'].includes(payload.reason)?'task':'conversation');
 if(!['conversation','task'].includes(purpose))throw Error('模型调用用途无效');
 const override=payload.preset&&Object.hasOwn(config.presets,payload.preset)?config.presets[payload.preset]:null;
 const selected=payload.preset==='qq-task-worker'?selectTaskModel(config,payload.modelSelection):override||config[purpose];
 return {provider:selected.provider,model:selected.model,...(selected.effort?{reasoningEffort:selected.effort}:{}),reason:override?'preset:'+payload.preset:purpose};
}
export function readCostPolicy(root){
 let raw={};try{raw=JSON.parse(fs.readFileSync(path.join(root,'state/plugins/config/obs-cost-policy.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('调用策略配置不可读');}
 return normalizeModelPolicy(raw);
}
export function resolveCallPolicy(host,root,payload={}){
 return host?.callService('cost-policy','select',payload)||selectCostPolicy(readCostPolicy(root),payload);
}
