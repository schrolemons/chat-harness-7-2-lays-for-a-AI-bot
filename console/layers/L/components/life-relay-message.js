
export default {saveLabel:"保存传话间隔",
      title: '传话组件',
      fields: [{ key: 'minIntervalMin', label: '每次传话最短间隔（分钟）', help: '按发起会话计算；管理员不受限制。', type: 'number', min: 1, max: 1440 }]
    };
