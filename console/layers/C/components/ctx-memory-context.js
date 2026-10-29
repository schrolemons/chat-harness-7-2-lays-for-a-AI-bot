
export default {saveLabel:"保存记忆注入预算", title: '记忆注入', fields: [
      { key: 'maxChars', label: '会话事实与今日画像注入预算（字符）', type: 'number', min: 500, max: 20000 },
      { key: 'affairsMaxChars', label: '当前事务注入预算（字符，按完整条目选择）', type: 'number', min: 200, max: 10000 }
    ] };
