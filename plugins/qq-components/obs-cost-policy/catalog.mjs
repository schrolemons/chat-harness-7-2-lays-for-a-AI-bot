import {normalizeModelPolicy,validateModelSelection,validateTaskModelRange} from './policy.mjs';

/** DSH owns model identity and reasoning vocabulary, including off and custom levels. */
export function validateCatalogPolicy(config,catalog){
  const next=normalizeModelPolicy(config);
  for(const selection of [next.conversation,next.task,...Object.values(next.presets)])selection.allowed?validateCatalogRange(selection,catalog):validateCatalogSelection(selection,catalog);
  return next;
}
export function validateCatalogRange(value,catalog){
 const range=validateTaskModelRange(value);
 for(const {provider,model,efforts} of range.allowed)for(const effort of efforts)validateCatalogSelection({provider,model,effort},catalog);
 return range;
}
export function validateCatalogSelection(selection,catalog){
  const value=validateModelSelection(selection),{provider,model,effort}=value;
  const entry=catalog.groups.find(group=>group.id===provider)?.models?.find(entry=>entry.id===model);
  if(!entry)throw Error(`模型不在 DSH 当前目录中：${provider} / ${model}`);
  if(effort&&!entry.reasoning?.efforts?.some(option=>option.id===effort))throw Error(`DSH 模型 ${provider} / ${model} 不支持思考档位 ${effort}`);
  return value;
}

/** Deduplicate concurrent reads; never substitute a hidden model list on failure. */
export function createModelCatalogReader(fetchCatalog){
  let pending;
  return ()=>{
    if(!pending)pending=Promise.resolve().then(fetchCatalog).then(catalog=>{
      if(!Array.isArray(catalog?.groups)||catalog.groups.some(group=>typeof group.id!=='string'||!Array.isArray(group.models)))throw Error('DSH 模型目录格式无效');
      return {groups:catalog.groups,...(catalog.default?{default:catalog.default}:{}),failures:catalog.failures||[]};
    }).finally(()=>{pending=null;});
    return pending;
  };
}
