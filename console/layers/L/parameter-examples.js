// Behavior examples owned by this layer; no runtime configuration values.
export default {
  "life-daily-worklog": {
    "hour": "小时23、分钟0：到23:00生成日报；启用发送时再按投递规则发出。",
    "minute": "小时23、分钟30：触发时间是23:30，而不是每30分钟一次。",
    "sendToOwner": "开启后可向管理员发送短报；关闭后仍可保留和查看本地完整归档。",
    "maxChars": "设为2000：约束面向聊天的摘要预算，完整归档不会因此只剩2000字。"
  },
  "life-message-ack": {
    "privateWait": "设为8秒：私聊最新来信后仍未正式回复，才触发等待提示；新来信会重置本轮。",
    "privateApology": "设为30秒：私聊思考继续超过延迟后可发这组补话，正式回复实际发送前取消计时。",
    "groupWait": "开启后，群内符合回应条件的未答消息使用这组等待话术；不是对所有群消息都提示。",
    "groupApology": "填写多条话术：群内超时补话从本组选择，不与静默后预算机械回复共用词表。"
  },
  "life-proactive-startup-greeting": {
    "hint": "填“先看看对方现在是否方便”：开机问候生成时参考，不会原样当固定群发消息。",
    "cooldownMinutes": "设为360：同一会话6小时内再次开机时，不重复触发这类起床问候。"
  },
  "life-proactive-time-bubble": {
    "maxBubblesPerDay": "设为4：同一会话一天最多配置4个时间冒泡时段；空时段列表不发送。"
  },
  "life-relay-message": {
    "minIntervalMin": "设为10：同一传话目标的自动转达至少间隔10分钟，避免重复刷屏。"
  },
  "life-schedule-reminder": {
    "enabled": "关闭后停止本组件的日程提醒；不会把原有日程记录直接删掉。",
    "advanceMinutes": "设为10：允许从日程开始前10分钟进入提醒阶段。",
    "intervalMinutes": "设为15：未完成日程可按15分钟间隔重复提醒，直到明确完成或不再满足时效。",
    "lateMinutes": "设为60：过期后1小时作为逾期处理边界，不把很久以前的提醒无限重放。",
    "horizonDays": "设为7：排程查询优先覆盖未来7天。",
    "maxItems": "设为100：日程列表的管理容量受100项门槛约束。",
    "maxPromptItems": "设为5：一次提醒回合最多给模型5项，避免把整个日历塞进提示词。"
  },
  "life-scheduler": {
    "maxJobs": "1000 表示所有会话合计最多登记1000项。满后拒绝新增，已有任务保留。"
  },
  "life-task-session": {
    "maxConcurrentTasks": "设为3时，执行中和等待补充信息的任务合计最多3个。",
    "maxTasks": "设为20时，新建任务优先清理最旧的已结束记录，进行中的任务保留。"
  },
  "life-token-budget": {
    "sessions": "为某个private或group会话设置单独花费阈值，只影响该会话预算。",
    "ownerBudgetEnabled": "开启后管理员会话也检查所设置的预算，不默认豁免。",
    "globalHardLimitYuan": "设为2.5：本周期全局计费达到2.5元后，模型调用按硬上限阻断；不等于删除通知排程。",
    "recoveryWindows": "私聊、群聊、管理员都设为5：恢复后只处理对应最近5条窗口，不把全部历史重新交给模型。",
    "mechanicalPrivateReplies": "每行写一条私聊超额短句，硬上限后从这里选择，不调用LLM生成。",
    "mechanicalGroupReplies": "每行写一条群聊超额短句；与模型思考期间四组补话分开维护。"
  }
};
