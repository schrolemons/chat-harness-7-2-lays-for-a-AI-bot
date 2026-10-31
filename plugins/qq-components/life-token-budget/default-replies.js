// 固定回复只在额度硬上限后的机械模式使用，不经过模型生成。
export const DEFAULT_PRIVATE_REPLIES = Object.freeze([
  '本会话已达到调用额度上限，暂时无法生成新的回答。',
  '当前额度已用完；日程等已登记的直接通知仍按设置执行。'
]);
export const DEFAULT_GROUP_REPLIES = Object.freeze([
  '本群已达到调用额度上限，暂时无法生成新的回答。',
  '当前群聊额度已用完；已登记的直接通知仍按设置执行。'
]);
