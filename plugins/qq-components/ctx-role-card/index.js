// ctx-role-card（C 层｜角色卡清洗服务）
//
// 角色卡正文的读取仍由桥接负责（roles/*.md + 当前角色状态），
// 但「二代模式专用清洗」是纯文本规则，搬进本组件：
//   · 去掉第一代专属指令行；
//   · 「回复示例」小节里的中文空格改写成逗号（避免被当成多条消息）。
//
// 桥接在 deliverPromptNow 里调用 `services.roleCard.clean(raw)`，拿不到服务时退回原文。

import { cleanRoleHint } from '../../../src/role-hint.js';

export function createPlugin(ctx) {
  return {
    services: {
      'role-card': {
        clean(raw) {
          try { return cleanRoleHint(String(raw || '')); } catch (error) { ctx.warn('角色卡清洗失败：' + (error?.message ?? error)); return String(raw || ''); }
        }
      }
    }
  };
}
