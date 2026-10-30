import {snapshotModule} from './message-snapshot.mjs';
// Read-only inventory/selection metadata. Does not invoke prompt hooks or a model.
export const KNOWLEDGE_MODULES=Object.freeze([
 {id:'slang-context',name:'黑话',service:'slang',kind:'slang',page:'slang'},
 {id:'ctx-interest-terms',name:'词条',service:'terms',kind:'term',page:'terms'},
 {id:'ctx-member-alias',name:'绰号',service:'aliases',kind:'alias',page:'alias'}
]);
export function inspectKnowledge(ctx,key){
 return Object.fromEntries(KNOWLEDGE_MODULES.map(def=>{
  let report=null;try{if(key)report=ctx.callService?.(def.service,'injectionPreview',{key});}catch{}
  return [def.id,{...def,available:!!report,...(report||{}),at:Date.now()}];
 }));
}
export function knowledgeModules(modules=[],reports={},snapshot=false){
 const result=modules.map(original=>{const row=snapshotModule(original);const info=reports[row.id];return info?{...row,name:info.name,...(snapshot?{knowledge:info}:{})}:row;});
 return result;
}
// Called on the actual frozen request, before redaction. No request mutation.
export function observeModuleDelivery(modules,messages){
 const text=(messages||[]).flatMap(m=>(m.content||[]).filter(c=>c.type==='text').map(c=>c.text||'')).join('\n');
 return modules.map(row=>{const parts=row.parts?.map(part=>({...part,inRequest:row.included===true&&!!part.text?.trim()&&text.includes(part.text.trim())}));return {...row,...(parts?{parts}:{}),inRequest:row.included===true&&(parts?parts.filter(part=>part.text?.trim()).every(part=>part.inRequest):!!row.text?.trim()&&text.includes(row.text.trim()))};});
}
