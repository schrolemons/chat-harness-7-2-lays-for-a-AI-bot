
export default {saveLabel:"保存思考补话规则", title: '四组独立启用、延迟和话术；从最新完整用户消息起算。新消息取消旧轮，正式回复实际发送前取消两个计时器。', fields: [
      { key: 'privateWait', label: '私聊 · 等待中', type: 'ackGroup' },
      { key: 'privateApology', label: '私聊 · 抱歉', type: 'ackGroup' },
      { key: 'groupWait', label: '群聊 · 等待中', type: 'ackGroup' },
      { key: 'groupApology', label: '群聊 · 抱歉', type: 'ackGroup' }
    ] };
