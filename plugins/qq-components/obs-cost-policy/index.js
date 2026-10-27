// Local deterministic selection; never call a model to classify another model call.
const INTERNAL=/^(?:scheduledContact|maintenance|timeBubble|startupGreeting|memoryWrite|selfReview|selfOptimize|slangLearn|replyCheck|careCheck|newsShare|idleRescue|proactiveCheck|timeout|reminder|taskDone|bootstrap)$/;
const HARD=/重构|死锁|并发|完整实现|端到端|严格证明|数学推导|深度排查|回归测试|复杂算法|系统设计/i;
const WORK=/实现|修复|排查|调试|重构|证明|推导|设计|审计|测试|开发|debug|implement|review/i;
export function createPlugin(ctx) {
 const cfg=ctx.config||{},recent=new Map();
 const base=()=>({model:String(cfg.defaultModel||'deepseek-flash'),reasoningEffort:String(cfg.defaultEffort||'low'),reason:'default'});
 function select(p={}) {
  if(INTERNAL.test(String(p.reason||'').split(':')[0]))return base();
  const cached=recent.get(String(p.key||''));
  const text=String(p.task ?? p.incomingText ?? (cached && Date.now()-cached.at<300000 ? cached.text : '')).slice(0,8000);
  const explicit=/(?:使用|切换|用)\s*(?:deepseek[- ]?)?(?:v4[- ]?)?pro\b|高强度推理/i.test(text);
  return explicit||(cfg.autoUpgradeComplexTasks!==false&&WORK.test(text)&&HARD.test(text)) ? {model:String(cfg.upgradeModel||'deepseek-v4-pro'),reasoningEffort:String(cfg.upgradeEffort||'high'),reason:explicit?'explicit':'complex-task'} : base();
 }
 return {services:{'cost-policy':{select}},dispose(){recent.clear();},hooks:{onIncoming(p={}){
  if(!p.key)return;recent.set(String(p.key),{text:String(p.text||''),at:Date.now()});
  if(recent.size>200)recent.delete(recent.keys().next().value);
  if(typeof ctx.capabilities?.setCostTier==='function')ctx.capabilities.setCostTier(p.key,select({incomingText:p.text}));
 }}};
}
