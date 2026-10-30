// All values come from the current shared private/group wake configuration.
export function buildWakeGuidance(w={}, proactive=null) {
 const n=(key,fallback)=>Number.isFinite(Number(w[key]))?Number(w[key]):fallback;
 const stage=proactive?['静默主动：双方停止聊天 '+proactive.silenceMinutes+' 分钟进入静默；阶段初始概率 '+proactive.initialProbability+'，每阶段增加 '+proactive.probabilityStep+'，上限 '+proactive.probabilityMax+'。',
 '检验间隔从 '+proactive.checkMinMinutes+'～'+proactive.checkMaxMinutes+' 分钟开始，每阶段变化 '+proactive.intervalStepMinutes+' 分钟，最短 '+proactive.checkFloorMinutes+' 分钟；实际概率与间隔还受心情和聊天意愿共同缩放。',
 '主动最小间距 '+proactive.minActiveGapMinutes+' 分钟；最大静默 '+proactive.maxSilenceMinutes+' 分钟兜底，但不能绕过宵禁、免打扰和预算。用户来信及实际日程、冒泡等发送会重置静默阶段。'].join('\n'):'';
 const q=proactive||{};
 const nq=(key,fallback)=>Number.isFinite(Number(q[key]))?Number(q[key]):fallback;
 return ['【当前唤醒规则｜群聊来信与私聊回复】',stage,
 '尚未开启群聊会话时：使用当前静默阶段的主动概率 p，加上本条命中的 @、管理员名字、向bot提问、拍bot四项中最大的加成 q，按 min(1,p+q) 判定是否开启会话。例如 p=0.2，同时命中q=0.5与q=0.3，最终0.7；没有命中时q=0。',
 '@或引用bot的加成='+nq('groupAtBonus',.6)+'；叫名字='+nq('groupNameBonus',.4)+'；向bot提问='+nq('groupQuestionBonus',.3)+'；拍bot='+nq('groupPokeBonus',.6)+'。0表示不提供该项加成；名字只匹配管理员字段：'+(q.groupNames||'未设置')+'。',
 '群聊一旦被唤醒，后续来信不再逐条抽签，与私聊共用读取、回复、消息频率和等待窗口机制。等待工具判定endRound=true后，本轮会话结束，再恢复递增主动概率；不要在会话结束后继续追发。',
 '私聊来信100%进入唤醒与回复流程，不参加概率抽签，也不受群聊触发条件限制；每条都要回应。独立额度、免打扰、静音与权限继续生效，不可用来信概率默默忽略。不要另行调用工具重设固定概率、触发条件或活跃模式。普通潜水不额外安排到期检查。',
 '群聊来信唤醒（仅群聊）每分钟最多 '+n('maxWakePerMinute',1)+' 次、每小时最多 '+n('maxWakePerHour',12)+' 次（0不限）；私聊不受此频率限制。超过限制延后处理，不丢未读。',
 '每波实际回复和回执后，用 qq_wait_for_messages 等新互动；无人回复按发送与等待中的结束概率 p、增量 q 判断，确认静默用 qq_wait_for_quiet。这是本轮等待何时结束，和群聊来信、静默后的主动开口都不同。',
 '无人来信时的主动机会由“发送与等待”安排；定时冒泡、日程提醒和明确约定时间的联系由各自排程处理。',
 '群聊概率通过仅表示进入回复工作流；是否适合接话仍结合上下文。无需模型的日程与通知按各自投递规则执行。',
 w.recommendedHint?'补充偏好：'+String(w.recommendedHint):''].filter(Boolean).join('\n');
}
