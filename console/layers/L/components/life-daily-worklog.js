
export default {
      title: '运维日报',
      fields: [
        { key: 'hour', label: '生成时间（时）', type: 'number', min: 0, max: 23 },
        { key: 'minute', label: '生成时间（分）', type: 'number', min: 0, max: 59 },
        { key: 'maxChars', label: '日报最大字数', type: 'number', min: 1000, max: 20000 },
        { key: 'sendToOwner', label: '生成后私聊发送摘要', type: 'boolean' }
      ]
    };
