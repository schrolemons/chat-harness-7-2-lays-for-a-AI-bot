const SKIP=/^(selfReview|selfOptimize|memoryWrite|timeBubble|startupGreeting|reminder|newFriend|newsShare|careCheck|idleRescue|proactiveCheck|replyCheck|taskDone|taskQuestion)/;
const RISK=/(我|自己).{0,8}(不想活|想死|想自杀|要自杀|准备自杀|想自残|已经自残|已经割伤|已经吞药|打算结束生命)|活不下去|不想活了|撑不下去了/;
export function pickText(payload={}){const rows=payload.st?.unread;return Array.isArray(rows)&&rows.length?rows.filter(x=>x&&!x.isSelf).slice(-8).map(x=>[x.plain??x.text??'',x.tail??''].join('\n')).join('\n').slice(-16000):String(payload.incomingText||'').slice(0,16000);}
export function createRouter(behavior={},config={}){
 const care=new Set(config.careSessionKeys||[]),scope=new Set(config.referenceSessionKeys||[]);
 const discussion=(behavior.discussion_patterns||[]).map(x=>new RegExp(x,'i')),concern=(behavior.care_patterns||[]).map(x=>new RegExp(x,'i'));
 const commands=behavior.discussion_commands||[],exit=(behavior.exit_patterns||[]).map(x=>new RegExp(x,'i'));
 return(payload={})=>{
  if(payload.hasUnreadNow===false||SKIP.test(String(payload.reason||'')))return{mode:'off',reason:'no-new-conversation-input'};
  if(scope.size&&!scope.has(payload.key))return{mode:'off',reason:'outside-reference-scope'};
  const text=pickText(payload);if(RISK.test(text))return{mode:'safety_support',reason:'possible-current-danger-not-a-diagnosis'};
  for(const command of commands){const escaped=command.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(new RegExp('(?:^|\\s)'+escaped+'\\s+(off|exit)\\b','i').test(text))return{mode:'off',reason:'user-exit'};}
  if(/停止使用资料/.test(text)||exit.some(x=>x.test(text)))return{mode:'off',reason:'user-exit'};
  const explicit=commands.some(command=>{const escaped=command.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp('(?:^|\\s)'+escaped+'(?:\\s|$)','i').test(text);});
  if(explicit||discussion.some(x=>x.test(text)))return{mode:'discussion',reason:'explicit-or-package-topic'};
  if(care.has(payload.key)&&concern.some(x=>x.test(text)))return{mode:'care',reason:'selected-session-current-concern'};
  return{mode:'off',reason:'ordinary-conversation'};
 };
}
