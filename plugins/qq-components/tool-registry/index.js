// 工具注册表插件（T 层，声明层）
//
// 现状：29 个 QQ 工具的实际实现在独立 MCP 进程（src/mcp-snowluma-safe.js），
// 那里同时承担「schema + 鉴权 + 转发到桥接」三件事，混在一起。
// 这个插件先把**声明**抽出来：名字、分类、权限等级、能力说明。
//
// 下一步（同一层的后续迭代）：桥接按这份声明做代理注册，MCP 进程只剩执行壳；
// 工具开关/权限从 config 挪到声明里，管理页可直接看与改。

const TOOLS = [
  // 观察
  { name: 'qq_get_prompt', category: 'observe', level: 'read', desc: '看当前角色/推荐值/工具面/唤醒配置' },
  { name: 'qq_get_unread_messages', category: 'observe', level: 'read', desc: '读未读消息（不自动已读）' },
  { name: 'qq_get_recent_messages', category: 'observe', level: 'read', desc: '读最近消息，可向前翻' },
  { name: 'qq_social_state', category: 'observe', level: 'read', desc: '看会话状态/唤醒配置/未读数' },
  { name: 'qq_get_my_recent_messages', category: 'observe', level: 'read', desc: '看自己最近发了什么' },
  { name: 'qq_get_message_detail', category: 'observe', level: 'read', desc: '按 id 看单条消息与引用' },
  { name: 'qq_get_active_members', category: 'observe', level: 'read', desc: '看最近活跃成员' },
  { name: 'qq_get_forward_msg', category: 'observe', level: 'read', desc: '看合并转发内容' },
  // 发送
  { name: 'qq_send_message', category: 'send', level: 'write', desc: '统一发送（一条/多条/引用/@）' },
  { name: 'qq_send_group_message', category: 'send', level: 'write', desc: '发群消息' },
  { name: 'qq_send_private_message', category: 'send', level: 'write', desc: '发私聊消息' },
  { name: 'qq_reply', category: 'send', level: 'write', desc: '引用回复' },
  { name: 'qq_send_burst', category: 'send', level: 'write', desc: '分多条发送' },
  { name: 'qq_send_poke', category: 'send', level: 'write', desc: '拍一拍' },
  { name: 'qq_send_file', category: 'send', level: 'write', desc: '发文件（仅管理员私聊）' },
  // 等待/收尾
  { name: 'qq_wait_for_messages', category: 'wait', level: 'read', desc: '首答静默/沉睡前观察/等下文' },
  { name: 'qq_mark_read', category: 'wait', level: 'write', desc: '标记已读（带水位）' },
  { name: 'qq_set_wake_config', category: 'wait', level: 'write', desc: '设置下一次唤醒条件' },
  // 记忆
  { name: 'qq_memory_append', category: 'memory', level: 'write', desc: '记一条轻量记忆（话题/想法/未发言成员的临时印象）' },
  { name: 'qq_memory_query', category: 'memory', level: 'read', desc: '查轻量记忆' },
  { name: 'qq_memory_remove', category: 'memory', level: 'write', desc: '删一条轻量记忆' },
  { name: 'qq_memory_clear', category: 'memory', level: 'write', desc: '清空轻量记忆' },
  { name: 'qq_task_note', category: 'memory', level: 'write', desc: '中期任务进度（append/list）' },
  // 表达/媒体
  { name: 'qq_list_stickers', category: 'media', level: 'read', desc: '列收藏表情' },
  { name: 'qq_get_sticker_image', category: 'media', level: 'read', desc: '看某张收藏表情' },
  { name: 'qq_send_sticker', category: 'media', level: 'write', desc: '发一张收藏表情' },
  { name: 'qq_sticker_note', category: 'media', level: 'write', desc: '记表情含义/标签' },
  { name: 'qq_collect_sticker', category: 'media', level: 'write', desc: '收藏别人的表情' },
  { name: 'qq_get_message_images', category: 'media', level: 'read', desc: '看消息里的图片/表情' },
  { name: 'qq_get_self_image', category: 'media', level: 'read', desc: '看自己的默认形象' },
  // 学习/反馈
  { name: 'qq_slang_query', category: 'learn', level: 'read', desc: '查群聊黑话' },
  { name: 'qq_slang_submit', category: 'learn', level: 'write', desc: '提交候选黑话' },
  { name: 'qq_report_feedback', category: 'learn', level: 'write', desc: '向管理端反馈问题' }
];

const LEVEL_NAMES = { read: '只读', write: '写入/外发' };

export function createPlugin(ctx) {
  ctx.registerTool('tool_list', {
    description: '按分类列出已声明的 QQ 工具（名字/权限等级）',
    handler: ({ category } = {}) => {
      const list = TOOLS.filter((t) => !category || t.category === String(category));
      return {
        ok: true,
        total: TOOLS.length,
        categories: [...new Set(TOOLS.map((t) => t.category))],
        tools: list.map((t) => ({ name: t.name, category: t.category, level: t.level, levelName: LEVEL_NAMES[t.level] || t.level }))
      };
    }
  });

  ctx.registerTool('tool_describe', {
    description: '查看单个工具的声明（分类/权限/能力说明）',
    handler: ({ name } = {}) => {
      const t = TOOLS.find((x) => x.name === String(name || ''));
      if (!t) return { ok: false, error: '没有这个工具：' + name };
      return { ok: true, tool: { ...t, levelName: LEVEL_NAMES[t.level] || t.level } };
    }
  });

  return {
    hooks: {
      beforePrompt(payload) {
        // 默认不往提示词里塞工具清单（MCP 已提供 schema，多了是噪音）。
        if (!(ctx.config || {}).injectPrompt) return '';
        return '【工具注册表】可用 qq 工具共 ' + TOOLS.length + ' 个；用 tool_list / tool_describe 查询声明与权限等级。';
      }
    }
  };
}
