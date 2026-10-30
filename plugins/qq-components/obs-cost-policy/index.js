// Local deterministic selection; never call a model to classify another model call.
import {selectCostPolicy} from './policy.mjs';
export function createPlugin(ctx) {
 const cfg=ctx.config||{},recent=new Map();
 function select(p={}) {
  const cached=recent.get(String(p.key||''));
  const text=String(p.task ?? p.incomingText ?? (cached && Date.now()-cached.at<300000 ? cached.text : '')).slice(0,8000);
  return selectCostPolicy(cfg,{...p,incomingText:text});
 }
 return {services:{'cost-policy':{select,sync:()=>ctx.capabilities?.synchronizeCostPolicy?.()||{ok:false,error:'当前桥接尚未加载统一模型同步能力'}}},dispose(){recent.clear();},hooks:{onIncoming(p={}){
  if(!p.key)return;recent.set(String(p.key),{text:String(p.text||''),at:Date.now()});
  if(recent.size>200)recent.delete(recent.keys().next().value);
  if(typeof ctx.capabilities?.setCostTier==='function')ctx.capabilities.setCostTier(p.key,select({incomingText:p.text}));
 }}};
}
