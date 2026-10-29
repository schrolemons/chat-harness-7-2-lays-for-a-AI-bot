
export default {saveLabel:"保存浏览器操作规则",
      title: '网址范围',
      fields: [
        { key: 'allowUrls', label: '允许访问的网址（每行一个）', help: '留空表示不限定。当前用于告知 AI 访问范围。', type: 'lines' },
        { key: 'blockUrls', label: '禁止访问的网址（每行一个）', help: '优先于允许列表；当前用于告知 AI 避开这些地址。', type: 'lines' }
      ]
    };
