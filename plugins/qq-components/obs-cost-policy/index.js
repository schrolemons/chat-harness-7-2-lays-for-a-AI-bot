import {selectCostPolicy,normalizeModelPolicy,readCostPolicy} from './policy.mjs';
export function createPlugin(ctx){
 // Read the owning file to migrate old fields before the host filters retired manifest keys.
 const config=ctx.root?readCostPolicy(ctx.root):normalizeModelPolicy(ctx.config||{});
 return {
  validateConfig(value){try{normalizeModelPolicy(value);return {ok:true};}catch(error){return {ok:false,errors:[error.message]};}},
  services:{'cost-policy':{select:payload=>selectCostPolicy(config,payload),sync:()=>ctx.capabilities?.synchronizeCostPolicy?.()||{ok:false,error:'桥接尚未加载模型同步能力'}}}
 };
}
