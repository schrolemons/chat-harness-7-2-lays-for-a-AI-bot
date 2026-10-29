
export default {saveLabel:"保存全局话题跟进规则", title: '话题跟进', fields: [
      { key: 'privateFollowupEnabled', label: '允许群聊后私聊跟进', help: '鲸鱼自行判断是否值得追问；只联系确有私聊关系的人。', type: 'boolean' },
      { key: 'minIntervalMinutes', label: '全局私聊跟进最小间隔（分钟）', help: '两次私聊跟进之间至少间隔多久；间隔采用较大值，每日上限采用较小值。', type: 'number', min: 0, max: 10080 },
      { key: 'dailyLimit', label: '全局每日私聊跟进上限', help: '每天最多向同一人私聊跟进几次；间隔采用较大值，每日上限采用较小值。', type: 'number', min: 0, max: 30 },
      { key: 'followUpCooldownMinutes', label: '同一话题跟进冷却（分钟）', help: '普通聊天与主动消息共用的跟进冷却指引。', type: 'number', min: 0 },
      { key: 'newTopicCooldownMinutes', label: '新话题冷却（分钟）', help: '普通聊天与主动消息共用的新话题冷却指引。', type: 'number', min: 0 },
      { key: 'newTopicMaxPerHour', label: '每小时最多新话题数', help: '普通聊天与主动消息共用的模型选择指引；依据真实发送收据更新，不是语义硬拦截。', type: 'number', min: 0, max: 60 }
    ] };
