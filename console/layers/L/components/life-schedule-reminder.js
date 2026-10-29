
export default {saveLabel:"保存全局日程规则", title: '日程提醒设置', fields: [
      { key: 'enabled', label: '启用日程提醒', help: '只控制日程到点提醒与日程上下文注入；不会影响定时主动消息。', type: 'boolean' },
      { key: 'advanceMinutes', label: '全局默认提醒开始提前量（分钟）', help: '日程未单独设置 leadMinutes 时使用；0 表示到日程时间才开始提醒。', type: 'number', min: 0, max: 1440 },
      { key: 'intervalMinutes', label: '全局默认提醒间歇周期（分钟）', help: '日程未单独设置 intervalMinutes 时使用；从提醒开始后持续间歇提醒，直到用户明确确认已经去做。', type: 'number', min: 1, max: 1440 },
      { key: 'horizonDays', label: '总览与上下文范围（天）', type: 'number', min: 1, max: 90 },
      { key: 'maxItems', label: '最多保存的日程数', help: '达到上限后不再接受新的日程；不会删除现有日程。', type: 'number', min: 10, max: 1000 },
      { key: 'maxPromptItems', label: '每轮最多注入日程数', type: 'number', min: 1, max: 20 }
    ] };
