// Synthetic, recipient-free templates. Importing/previewing never creates runtime state.
export function createProactiveExamples(now = Date.now()) {
  const today = new Date(now);
  if (!Number.isFinite(today.getTime())) throw Error('示例日期无效');
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const sunday = new Date(today);
  sunday.setDate(today.getDate() + (7 - today.getDay()) % 7);
  sunday.setHours(20, 30, 0, 0);
  // Do not create a reminder whose lead window is already open.
  if (sunday.getTime() - 10 * 60000 <= now) sunday.setDate(sunday.getDate() + 7);
  return [
    {
      id: 'daily-bubbles', kind: 'bubbles', title: '时间冒泡 / 定时主动会话',
      description: '每天 09:00、12:30、20:30；建议每日上限 3。到点由模型按当前人设自然开口，参考话题不直接照发。',
      slots: [
        { id: 'example-daily-morning-v1', hour: 9, minute: 0, label: '示例·晨间计划', hint: '轻声问问今天想先做什么，不假定对方已经起床。', enabled: true, locked: false },
        { id: 'example-daily-noon-v1', hour: 12, minute: 30, label: '示例·午间休息', hint: '聊聊是否需要休息，不假定对方的饮食或作息。', enabled: true, locked: false },
        { id: 'example-daily-evening-v1', hour: 20, minute: 30, label: '示例·晚间回顾', hint: '邀请分享今天的一件小事，尊重对方现在是否方便。', enabled: true, locked: false }
      ]
    },
    {
      id: 'tomorrow-reminder', kind: 'schedule', title: '明日待办提醒',
      description: '明天 09:00「示例：整理今日计划」；提前 10 分钟开始，每 30 分钟提醒；一次性，明确完成后停止。',
      item: { title: '示例：整理今日计划', dueAt: tomorrow.getTime(), repeat: 'none', leadMinutes: 10, intervalMinutes: 30, detail: '开发者示例 [example:tomorrow-reminder:v1]，可按实际需要编辑或删除。' }
    },
    {
      id: 'weekly-review', kind: 'schedule', title: '每周回顾',
      description: '下一个尚未开始提醒的周日 20:30「示例：每周回顾」；每周重复，提前 10 分钟，每 30 分钟提醒；完成本次后进入下周。',
      item: { title: '示例：每周回顾', dueAt: sunday.getTime(), repeat: 'weekly', leadMinutes: 10, intervalMinutes: 30, detail: '开发者示例 [example:weekly-review:v1]，回顾一件进展并选择下一步。' }
    }
  ];
}

function checked(response) {
  if (!response || response.ok === false) throw Error(response?.error || '读取或保存示例失败');
  return response;
}

export async function applyProactiveExample({ templateId, key, optIn, now = Date.now(), api }) {
  if (optIn !== true) throw Error('请先明确同意为选中会话启用示例');
  if (!/^(private|group):\d+$/.test(key || '')) throw Error('请明确选择真实会话');
  const template = createProactiveExamples(now).find(x => x.id === templateId);
  if (!template) throw Error('未知示例');
  const states = checked(await api('/api/socialV2/states'));
  if (!states.conversations?.some(x => x.key === key)) throw Error('会话已不存在，请刷新并重新选择');
  if (template.kind === 'bubbles') {
    const result = await api('/api/socialV2/time-bubbles', 'POST', { key, appendSlots: template.slots });
    if (result?.error === 'LOCKED_SCHEDULE') throw Error('此会话冒泡栏已锁定（LOCKED_SCHEDULE），请先在时段编辑器解锁');
    if (result?.error === 'TIME_BUBBLE_CAPACITY') throw Error(`新增时段会超过每日上限 ${result.limit ?? ''}；请先在时段编辑器调整。`);
    checked(result);
    return { added: result.added, slots: result.addedSlots };
  }
  const result = await api('/api/socialV2/schedules', 'POST', { action: 'appendIfAbsent', exampleId: template.id + ':v1', key, ...template.item });
  if (result?.error === 'SCHEDULE_CAPACITY') throw Error(`日程已达到容量上限 ${result.limit ?? ''}；请先整理现有日程，示例未添加。`);
  checked(result);
  return { added: result.added };
}
