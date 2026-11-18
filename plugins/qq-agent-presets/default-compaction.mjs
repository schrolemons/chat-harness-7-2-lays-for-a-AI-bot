// Thin native adapter: compaction follows the same selected global model as
// ordinary conversation, without embedding a provider/model in preset YAML.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeModelPolicy} from '../qq-components/obs-cost-policy/policy.mjs';
import {createHostImport} from '../../src/dsh-host-import.mjs';

export const name='qq-default-compaction';
export const inject=['llm','tokenMeter','sessions','loader'];
export function readGlobalModel(root){
 const file=path.join(root,'state/plugins/config/obs-cost-policy.json');
 // Missing configuration is an error, never a silent paid-provider fallback.
 const raw=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!raw.conversation)throw Error('全局默认模型尚未配置，拒绝自行选择摘要供应商');
 return normalizeModelPolicy(raw).conversation;
}
function contextView(ctx,overrides){
 const llm=new Proxy(ctx.llm,{get(target,field){
  if(Object.hasOwn(overrides,field))return overrides[field];
  const value=Reflect.get(target,field,target);return typeof value==='function'?value.bind(target):value;
 }});
 return new Proxy(ctx,{get(target,field){
  if(field==='llm')return llm;
  const value=Reflect.get(target,field,target);return typeof value==='function'?value.bind(target):value;
 }});
}
export function defaultCompactionClass(Base,readSelection,{maxContextTokens=0}={}){
 if(typeof Base?.prototype?.summarize!=='function')throw Error('Native compaction backend lacks its summarization adapter hook');
 if(!Number.isSafeInteger(maxContextTokens)||maxContextTokens<0)throw Error('聊天压缩上下文预算必须是非负整数');
 return class DefaultModelCompaction extends Base {
  async compactIfNeeded(agent,trigger,signal){
   if(!maxContextTokens)return super.compactIfNeeded(agent,trigger,signal);
   const ctx=this.ctx,receiver=Object.create(this);
   Object.defineProperty(receiver,'ctx',{value:contextView(ctx,{resolveModelInfo:async(...args)=>{
    const info=await ctx.llm.resolveModelInfo(...args);
    return info.context?{...info,context:{...info.context,contextWindow:Math.min(info.context.contextWindow,maxContextTokens)}}:info;
   }})});
   // Limit only this preset's pressure measurement. The adapter's real model
   // capability and independent-task context window remain unchanged.
   return super.compactIfNeeded.call(receiver,agent,trigger,signal);
  }
  async summarize(input,agent,signal){
   const selection=readSelection();
   const source=this,receiver=Object.create(this);
   // Do not mutate the native frozen policy or a shared engine while another
   // session summarizes. Capture the selected route once for this actual call.
   const route={summarizationProvider:selection.provider,summarizationModel:selection.model};
   Object.defineProperty(receiver,'config',{value:{...this.config,...route,modelPolicies:(this.config.modelPolicies||[]).map(p=>({...p,...route}))}});
   Object.defineProperty(receiver,'ctx',{value:contextView(this.ctx,{stream:options=>source.ctx.llm.stream({...options,provider:selection.provider,model:selection.model,...(selection.effort?{reasoningEffort:selection.effort}:{})})})});
   // Native summarization still owns the instruction, checkpoint, actual model
   // identity, token usage, convergence checks and durable surface transaction.
   return super.summarize.call(receiver,input,agent,signal);
  }
 };
}
export async function apply(ctx,config={}){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 const {BasicCompactionEngine}=await createHostImport(ctx)('@deepseek-ai/dsh-compaction-basic');
 const read=()=>readGlobalModel(root);read();
 const Native=defaultCompactionClass(BasicCompactionEngine,read,{maxContextTokens:config.maxContextTokens??0});
 const inherited={...config};delete inherited.maxContextTokens;delete inherited.summarizationProvider;delete inherited.summarizationModel;
 const fiber=ctx.plugin(Native,inherited);await fiber;
 return ()=>fiber.dispose();
}
