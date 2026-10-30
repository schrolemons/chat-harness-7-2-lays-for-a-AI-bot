
export default {saveLabel:"保存注入实验设置", title: '提示词注入实验室', fields: [
      { key: 'detect', label: '启用检测', help: '记录实验中观察到的注入迹象。', type: 'boolean' },
      { key: 'alertWindowMs', label: '注入警报保留时长（毫秒）', help: '最近一次检测到疑似注入后，在此时长内继续向 bot 的后续上下文注入警报；再次命中会重新计时。最低 60000 毫秒（1 分钟），默认 600000 毫秒（10 分钟）。', type: 'number', min: 60000 },
      { key: 'sparPerHour', label: '每小时最多对线次数', help: '限制实验工具的触发频率。', type: 'number', min: 0, max: 60 }
    ] };
