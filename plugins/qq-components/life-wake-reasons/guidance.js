// All values come from the current shared private/group wake configuration.
export function buildWakeGuidance(w={}, proactive=null) {
 const n=(key,fallback)=>Number.isFinite(Number(w[key]))?Number(w[key]):fallback;
 const stage=proactive?['静默主动：双方停止聊天 '+proactive.silenceMinutes+' 分钟进入静默；阶段初始概率 '+proactive.initialProbability+'，每阶段增加 '+proactive.probabilityStep+'，上限 '+proactive.probabilityMax+'。',
 '检验间隔从 '+proactive.checkMinMinutes+'～'+proactive.checkMaxMinutes+' 分钟开始，每阶段变化 '+proactive.intervalStepMinutes+' 分钟，最短 '+proactive.checkFloorMinutes+' 分钟；实际概率与间隔还受心情和聊天意愿共同缩放。',
 '主动最小间距 '+proactive.minActiveGapMinutes+' 分钟；最大静默 '+proactive.maxSilenceMinutes+' 分钟兜底，但不能绕过宵禁、免打扰和预算。用户来信及实际日程、冒泡等发送会重置静默阶段。'].join('\n'):'';
 const q=proactive||{};
 const nq=(key,fallback)=>Number.isFinite(Number(q[key]))?Number(q[key]):fallback;
 return ['【当前唤醒规则｜群聊来信与私聊回复】',stage,
 '群聊新来信：先读取来信前静默阶段的有效概率 p（含心情和聊天意愿），从命中的 @、管理员名字、向bot提问、拍bot四项中取最大额外概率 q，以 min(1,p+q) 立即判定一次；未命中则仅用 p。来信随后重置静默阶段，不能用重置后的 p 替代本次判定。',
 '@或引用bot的 q='+nq('groupAtBonus',.6)+'；名字 q='+nq('groupNameBonus',.4)+'；向bot提问 q='+nq('groupQuestionBonus',.3)+'；拍bot q='+nq('groupPokeBonus',.6)+'。q=0 不加成；名字只匹配管理员字段：'+(q.groupNames||'未设置')+'。例如 p=0.2，命中 q=0.5 和 q=0.3，最终0.7。',
 '私聊不参加概率抽签：每条来信均进入回复处理，独立限额、免打扰、静音与权限仍生效；不要另行调用工具重设固定概率、触发条件或活跃模式。普通潜水不额外安排到期检查。',
 '群聊来信唤醒（仅群聊）每分钟最多 '+n('maxWakePerMinute',1)+' 次、每小时最多 '+n('maxWakePerHour',12)+' 次（0不限）；私聊不受此频率限制。超过限制延后处理，不丢未读。',
 '每波实际回复和回执后，用 qq_wait_for_messages 等新互动；无人回复按发送与等待中的结束概率 p、增量 q 判断，确认静默用 qq_wait_for_quiet。两者不同于上面的群聊来信 p/q。',
 '无人来信时的主动机会由“发送与等待”安排；定时冒泡、日程提醒和明确约定时间的联系由各自排程处理。',
 '群聊概率通过仅表示进入回复工作流；是否适合接话仍结合上下文。无需模型的日程与通知按各自投递规则执行。',
 w.recommendedHint?'补充偏好：'+String(w.recommendedHint):''].filter(Boolean).join('\n');
}
