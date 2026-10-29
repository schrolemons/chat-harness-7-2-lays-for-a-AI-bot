// Labels and visual grouping only. Registration remains owned by src/tools/flags.js.
export const TOOL_PRESENTATION={
  "status": {
    "group": "读取与状态",
    "label": "连接状态",
    "example": "例：开启并保存后，可读取QQ连接与账号状态；仍受会话权限与额度约束。"
  },
  "getPrompt": {
    "group": "读取与状态",
    "label": "当前角色与规则",
    "example": "例：开启并保存后，可查看本轮角色、参数指引和允许工具；仍受会话权限与额度约束。"
  },
  "getUnread": {
    "group": "读取与状态",
    "label": "未处理来信",
    "example": "例：开启并保存后，可读取尚未完成处理的消息；仍受会话权限与额度约束。"
  },
  "getRecent": {
    "group": "读取与状态",
    "label": "最近聊天",
    "example": "例：开启并保存后，可读取当前会话的近期消息；仍受会话权限与额度约束。"
  },
  "socialState": {
    "group": "读取与状态",
    "label": "会话状态",
    "example": "例：开启并保存后，可查看当前会话状态与唤醒条件；仍受会话权限与额度约束。"
  },
  "getMyRecent": {
    "group": "读取与状态",
    "label": "bot 最近发言",
    "example": "例：开启并保存后，可核对bot刚才实际发过的内容；仍受会话权限与额度约束。"
  },
  "getMessageDetail": {
    "group": "读取与状态",
    "label": "消息与引用详情",
    "example": "例：开启并保存后，可按真实消息ID查看单条及引用关系；仍受会话权限与额度约束。"
  },
  "getActiveMembers": {
    "group": "读取与状态",
    "label": "近期活跃成员",
    "example": "例：开启并保存后，可查看当前会话近期参与者；仍受会话权限与额度约束。"
  },
  "getGroupMembers": {
    "group": "读取与状态",
    "label": "群成员列表",
    "example": "例：开启并保存后，可读取当前群成员信息；仍受会话权限与额度约束。"
  },
  "sendBurst": {
    "group": "回复、等待与收尾",
    "label": "分条发送",
    "example": "例：开启并保存后，可按当前发送计划分成多条发出；仍受会话权限与额度约束。"
  },
  "sendMessage": {
    "group": "回复、等待与收尾",
    "label": "发送聊天消息",
    "example": "例：开启并保存后，可在当前权限和发送计划内发言；仍受会话权限与额度约束。"
  },
  "waitMessages": {
    "group": "回复、等待与收尾",
    "label": "等待新消息",
    "example": "例：开启并保存后，可观察用户补充或等待后续来信；仍受会话权限与额度约束。"
  },
  "markRead": {
    "group": "回复、等待与收尾",
    "label": "标记已读与收尾",
    "example": "例：开启并保存后，可声明看过消息并完成相应回合收尾；仍受会话权限与额度约束。"
  },
  "reportReceipts": {
    "group": "回复、等待与收尾",
    "label": "逐条处理回报",
    "example": "例：开启并保存后，可按真实消息ID回报处理结果；仍受会话权限与额度约束。"
  },
  "setWakeConfig": {
    "group": "回复、等待与收尾",
    "label": "设置唤醒与意愿",
    "example": "例：开启并保存后，可设置下一次唤醒条件或评估聊天意愿；仍受会话权限与额度约束。"
  },
  "mood": {
    "group": "记忆、心情与排程",
    "label": "调整心情",
    "example": "例：开启并保存后，可按add或dec提交有依据的心情调整；仍受会话权限与额度约束。"
  },
  "taskNote": {
    "group": "记忆、心情与排程",
    "label": "当前事务",
    "example": "例：开启并保存后，可查看或更新任务、承诺和安排的状态；仍受会话权限与额度约束。"
  },
  "memory": {
    "group": "记忆、心情与排程",
    "label": "窗口轻量记忆",
    "example": "例：开启并保存后，可维护当前话题、待说想法与临时印象；仍受会话权限与额度约束。"
  },
  "schedule": {
    "group": "记忆、心情与排程",
    "label": "日程提醒",
    "example": "例：开启并保存后，可登记和管理属于当前会话的日程；仍受会话权限与额度约束。"
  },
  "timeBubbleManage": {
    "group": "记忆、心情与排程",
    "label": "定时冒泡",
    "example": "例：开启并保存后，可管理允许修改的定时主动时段；仍受会话权限与额度约束。"
  },
  "availability": {
    "group": "记忆、心情与排程",
    "label": "免打扰与稍后联系",
    "example": "例：开启并保存后，可登记或调整用户明确表达的时间意愿；仍受会话权限与额度约束。"
  },
  "slangQuery": {
    "group": "知识与反馈",
    "label": "查询黑话",
    "example": "例：开启并保存后，可查询已确认的黑话含义；仍受会话权限与额度约束。"
  },
  "slangSubmit": {
    "group": "知识与反馈",
    "label": "提交黑话候选",
    "example": "例：开启并保存后，可把陌生表达提交为待审核候选；仍受会话权限与额度约束。"
  },
  "termQuery": {
    "group": "知识与反馈",
    "label": "查询兴趣知识",
    "example": "例：开启并保存后，可查找已确认的兴趣词条与来源；仍受会话权限与额度约束。"
  },
  "termSubmit": {
    "group": "知识与反馈",
    "label": "提交兴趣候选",
    "example": "例：开启并保存后，可把待核实的知识提交为候选；仍受会话权限与额度约束。"
  },
  "feedback": {
    "group": "知识与反馈",
    "label": "报告问题",
    "example": "例：开启并保存后，可记录失败、异常或需要修复的问题；仍受会话权限与额度约束。"
  },
  "sendVoice": {
    "group": "图片、语音与文件",
    "label": "语音库与语音发送",
    "example": "例：开启并保存后，可查询语音素材并按权限发送；仍受会话权限与额度约束。"
  },
  "sendFile": {
    "group": "图片、语音与文件",
    "label": "发送文件",
    "example": "例：开启并保存后，可在管理员权限内发送允许的本地文件；仍受会话权限与额度约束。"
  },
  "sendPoke": {
    "group": "图片、语音与文件",
    "label": "拍一拍",
    "example": "例：开启并保存后，可向允许的对象发送拍一拍；仍受会话权限与额度约束。"
  },
  "getImages": {
    "group": "图片、语音与文件",
    "label": "读取消息图片",
    "example": "例：开启并保存后，可取得真实消息所附的图片；仍受会话权限与额度约束。"
  },
  "imageGeneration": {
    "group": "图片、语音与文件",
    "label": "图片生成",
    "example": "例：开启并保存后，可按生图服务设置和额度发起生成；仍受会话权限与额度约束。"
  },
  "imageTransfer": {
    "group": "图片、语音与文件",
    "label": "图片取回与转发",
    "example": "例：开启并保存后，可在当前范围内处理已生成或暂存图片；仍受会话权限与额度约束。"
  },
  "getForwardMsg": {
    "group": "图片、语音与文件",
    "label": "合并转发内容",
    "example": "例：开启并保存后，可读取真实合并转发消息；仍受会话权限与额度约束。"
  },
  "listStickers": {
    "group": "图片、语音与文件",
    "label": "收藏表情列表",
    "example": "例：开启并保存后，可查询可用的收藏表情；仍受会话权限与额度约束。"
  },
  "getStickerImage": {
    "group": "图片、语音与文件",
    "label": "查看收藏表情",
    "example": "例：开启并保存后，可读取选定表情的图像；仍受会话权限与额度约束。"
  },
  "sendSticker": {
    "group": "图片、语音与文件",
    "label": "发送收藏表情",
    "example": "例：开启并保存后，可按发送计划发出一个表情；仍受会话权限与额度约束。"
  },
  "collectSticker": {
    "group": "图片、语音与文件",
    "label": "收藏表情",
    "example": "例：开启并保存后，可按收藏频率限制收录表情；仍受会话权限与额度约束。"
  },
  "getSelfImage": {
    "group": "图片、语音与文件",
    "label": "角色自身形象",
    "example": "例：开启并保存后，可取得允许使用的角色图像；仍受会话权限与额度约束。"
  },
  "stickerNote": {
    "group": "图片、语音与文件",
    "label": "表情含义与标签",
    "example": "例：开启并保存后，可维护表情的语境含义；仍受会话权限与额度约束。"
  },
  "setStickerRemark": {
    "group": "图片、语音与文件",
    "label": "修改表情备注",
    "example": "例：开启并保存后，可在有权限时修改收藏备注；仍受会话权限与额度约束。"
  }
};
