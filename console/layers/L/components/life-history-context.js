export default {
  title: '历史上下文与恢复回复', saveLabel: '保存历史恢复规则',
  fields: [
    {key:'privateReplyLimit',label:'恢复后私聊最多待答消息（条）',type:'number'},
    {key:'historyLimit',label:'本地历史补取上限（条）',type:'number'},
    {key:'localHistoryEnabled',label:'只读本地 SnowLuma 消息缓存',type:'boolean'},
  ],
};
