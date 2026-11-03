import {loadInstanceSessionPolicy} from '../../../src/instance-session-policy.mjs';
// Read-only comparisons against owned definitions. Matching current files is
// explicitly weaker evidence than a historical configuration snapshot.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {CONTEXT_STATE_RULE,SESSION_CREDENTIAL_RULE} from './refill.mjs';
import {RECEIPT_INDEX_RULE} from './message-snapshot.mjs';

function persona(root,preset){
 if(!/^[a-zA-Z0-9_-]+$/.test(preset||''))return [];
 const source=`dsh/agent-presets/${preset}/agent.cordis.yml`;
 try{
  const rows=yaml.load(fs.readFileSync(path.join(root,source),'utf8'));
  const find=list=>Array.isArray(list)?list.flatMap(row=>row?.id==='persona'&&row.name==='@deepseek-ai/dsh-persona'?[row]:row?.group===true?find(row.config):[]):[];
  return find(rows).flatMap(row=>['prefix','suffix'].filter(field=>typeof row.config?.[field]==='string'&&row.config[field].trim()).map(field=>({id:`preset:${preset}:${field}`,name:`Agent 预设 ${preset}`,part:`persona.config.${field}`,source,text:row.config[field]})));
 }catch{return [];}
}
function presetParts(root,preset){
 const own=persona(root,preset);
 // The admin preset is derived from v2 by the bundle builder, rather than an
 // independent copy. Attribute its shared protocol to the actual v2 source.
 if(preset!=='qq-admin')return own;
 const shared=persona(root,'qq-chat-v2').filter(row=>row.part==='persona.config.prefix').flatMap(row=>{
  const start=row.text.indexOf('【二代仿真模式 —— 工具协议');
  return start<0?[]:[{...row,id:'preset:qq-admin:shared-v2',name:'Agent 预设 qq-admin · 继承 qq-chat-v2',part:'persona.config.prefix · 共享交互协议',text:row.text.slice(start)}];
 });
 return [...own,...shared];
}
const rules=[
 {id:'context-state-policy',name:'AI助手上下文状态规则',source:'plugins/qq-components/obs-context-assembly/refill.mjs',text:CONTEXT_STATE_RULE,roles:['system']},
 {id:'session-credential-policy',name:'AI助手会话令牌规则',source:'plugins/qq-components/obs-context-assembly/refill.mjs',text:SESSION_CREDENTIAL_RULE,roles:['system']},
 {id:'receipt-index-policy',name:'收件状态索引解释规则',source:'plugins/qq-components/obs-context-assembly/message-snapshot.mjs',text:RECEIPT_INDEX_RULE,roles:['user'],kinds:['qq-context-stable']}
];
export function annotateRequestSources(root,request,{sessionPolicy=loadInstanceSessionPolicy({root,env:{}})}={}){
 const sources=new Map(),definitions=new Map();
 const messages=(request.messages||[]).map(message=>{
  const preset=message.provenance?.agentPreset;
  if(preset&&!definitions.has(preset))definitions.set(preset,presetParts(root,sessionPolicy.canonicalPreset(preset)));
  const candidates=[...(message.role==='system'?definitions.get(preset)||[]:[]),...rules.filter(row=>row.roles.includes(message.role)&&(!row.kinds||row.kinds.includes(message.source)))],ranges=[];
  const text=String(message.text||'');
  for(const row of candidates){
   // Interpolated variable values have no archived definition here. Match only
   // the literal pieces, never use a wildcard to claim arbitrary system text.
   const literals=row.text.split(/\{\{[^{}]+\}\}/).map(value=>value.trim()).filter(Boolean);
   const pieces=literals.flatMap(value=>text.includes(value)?[value]:value.split(/\n\s*\n/).map(part=>part.trim()).filter(part=>part.length>=30));
   for(const piece of pieces){
    let start=text.indexOf(piece);
    while(start>=0){
     const end=start+piece.length;
     if(!ranges.some(other=>start<other.end&&end>other.start)){
      ranges.push({start,end,id:row.id,name:row.name,part:row.part,source:row.source,basis:'current-definition'});
      const prior=sources.get(row.id)||{id:row.id,name:row.name,source:row.source,text:'',parts:[],included:true,inRequest:true,provenanceOnly:true};
      if(!prior.parts.some(part=>part.text===piece)){prior.parts.push({text:piece,name:row.part});prior.text=prior.parts.map(part=>part.text).join('\n\n');}
      sources.set(row.id,prior);
     }
     start=text.indexOf(piece,end);
    }
   }
  }
  if(message.role!=='system'&&!ranges.length)return message;
  return {...message,sourceAttribution:{...(preset?{presetId:preset}:{}),ranges:ranges.sort((a,b)=>a.start-b.start)}};
 });
 return {...request,messages,sourceModules:[...sources.values()]};
}
