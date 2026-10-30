import fs from 'node:fs';import path from 'node:path';
export const COST_POLICY_DEFAULTS=Object.freeze({defaultModel:'deepseek-flash',defaultEffort:'low',upgradeModel:'deepseek-v4-pro',upgradeEffort:'high',autoUpgradeComplexTasks:true});
const INTERNAL=/^(?:scheduledContact|maintenance|timeBubble|startupGreeting|memoryWrite|selfReview|selfOptimize|slangLearn|replyCheck|careCheck|newsShare|idleRescue|proactiveCheck|timeout|reminder|taskDone|bootstrap|webSummary|policySync)$/;
const HARD=/重构|死锁|并发|完整实现|端到端|严格证明|数学推导|深度排查|回归测试|复杂算法|系统设计/i;
const WORK=/实现|修复|排查|调试|重构|证明|推导|设计|审计|测试|开发|debug|implement|review/i;
export function selectCostPolicy(raw={},payload={}){
 const cfg={...COST_POLICY_DEFAULTS,...raw};
 for(const key of ['defaultModel','upgradeModel'])if(!['deepseek-flash','deepseek-v4-pro'].includes(cfg[key]))throw Error('调用策略模型无效：'+key);
 for(const key of ['defaultEffort','upgradeEffort'])if(!['low','medium','high','max'].includes(cfg[key]))throw Error('调用策略思考强度无效：'+key);
 const base={model:cfg.defaultModel,reasoningEffort:cfg.defaultEffort,reason:'default'};
 if(INTERNAL.test(String(payload.reason||'').split(':')[0]))return base;
 const text=String(payload.task??payload.incomingText??'').slice(0,8000),explicit=/(?:使用|切换|用)\s*(?:deepseek[- ]?)?(?:v4[- ]?)?pro\b|高强度推理/i.test(text);
 return explicit||(cfg.autoUpgradeComplexTasks!==false&&WORK.test(text)&&HARD.test(text))?{model:cfg.upgradeModel,reasoningEffort:cfg.upgradeEffort,reason:explicit?'explicit':'complex-task'}:base;
}
export function readCostPolicy(root){
 const file=path.join(root,'state','plugins','config','obs-cost-policy.json');
 let raw={};try{raw=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('调用策略配置不可读');}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('调用策略配置无效');
 return {...COST_POLICY_DEFAULTS,...raw};
}
export function resolveCallPolicy(host,root,payload={}){
 return host?.callService('cost-policy','select',payload)||selectCostPolicy(readCostPolicy(root),payload);
}
