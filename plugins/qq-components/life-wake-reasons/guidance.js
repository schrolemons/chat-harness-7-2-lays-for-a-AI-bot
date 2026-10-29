// All values come from the current shared private/group wake configuration.
export function buildWakeGuidance(w={}, proactive=null) {
 const n=(key,fallback)=>Number.isFinite(Number(w[key]))?Number(w[key]):fallback;
 const stage=proactive?['静默主动：双方停止聊天 '+proactive.silenceMinutes+' 分钟进入静默；阶段初始概率 '+proactive.initialProbability+'，每阶段增加 '+proactive.probabilityStep+'，上限 '+proactive.probabilityMax+'。',
 '检验间隔从 '+proactive.checkMinMinutes+'～'+proactive.checkMaxMinutes+' 分钟开始，每阶段变化 '+proactive.intervalStepMinutes+' 分钟，最短 '+proactive.checkFloorMinutes+' 分钟；实际概率与间隔还受心情和聊天意愿共同缩放。',
 '主动最小间距 '+proactive.minActiveGapMinutes+' 分钟；最大静默 '+proactive.maxSilenceMinutes+' 分钟兜底，但不能绕过宵禁、免打扰和预算。用户来信及实际日程、冒泡等发送会重置静默阶段。'].join('\n'):'';
 const triggers=[['recommendedAtMention','@'],['recommendedNameMention','名字'],['recommendedQuestion','提问'],['recommendedPoke','拍一拍']].filter(([key])=>w[key]!==false).map(([,label])=>label);
 return ['【当前唤醒规则｜私聊与群聊共用】',stage,
 '推荐默认状态：'+(w.defaultMode==='active'?'活跃':'潜水')+'；默认下一次唤醒：'+(w.recommendedDefaultInfinite!==false?'无限期（仍可被已启用条件触发）':'有限期')+'。',
 '推荐有限潜水 '+n('recommendedSleepMinMs',300000)/60000+'～'+n('recommendedSleepMaxMs',7200000)/60000+' 分钟；普通消息概率 '+n('recommendedProbability',0.05)+'；推荐触发：'+triggers.join('、')+'。这些是推荐值，不代替硬限制。',
 '硬限制：有限潜水至少 '+n('sleepMinMs',60000)/1000+' 秒，最多 '+(n('sleepMaxMs',0)>0?n('sleepMaxMs',0)/1000+' 秒':'不设上限')+'；每分钟最多 '+n('maxWakePerMinute',1)+' 次、每小时最多 '+n('maxWakePerHour',12)+' 次（0 表示不限）。达到限频后延后处理，不丢弃未读。',
 w.preSleepWaitEnabled!==false&&n('preSleepWaitMs',300000)>0?'沉睡前观察 '+n('preSleepWaitMs',300000)/60000+' 分钟；这是收尾步骤，不是回复前必须等待的时间。':'沉睡前强制观察已关闭。',
 '私聊直接来信、群内明确找你的消息都优先处理；群里无关闲聊按触发条件与概率判断。免打扰、预算和权限继续生效；无需模型的日程与通知按各自投递规则执行。',
 w.recommendedHint?'补充偏好：'+String(w.recommendedHint):''].filter(Boolean).join('\n');
}
