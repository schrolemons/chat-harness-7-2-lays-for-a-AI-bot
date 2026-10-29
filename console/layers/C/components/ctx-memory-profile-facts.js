
export default {saveLabel:"保存事实提取规则", title: '用户画像事实', fields: [
      { key: 'cooldownMs', label: '画像提取冷却（分钟）', help: '设为 0 时，每轮新消息都可及时整理稳定人物事实；只有值得长期使用的信息才写入档案。', type: 'minutes', min: 0 },
      { key: 'maxSnippets', label: '每轮最多候选事实', help: '一轮最多挑出多少条值得记住的用户事实。', type: 'number', min: 1, max: 30 },
      { key: 'maxCharsPerSnippet', label: '单条事实最大字数', help: '防止把整段聊天记录当作一条画像事实。', type: 'number', min: 10, max: 1000 }
    ] };
