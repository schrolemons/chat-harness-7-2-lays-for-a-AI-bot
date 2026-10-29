
export default {saveLabel:"保存注入实验设置", title: '提示词注入实验室', fields: [
      { key: 'injectPrompt', label: '允许提示词注入实验', help: '只影响实验室工具提供的测试动作。', type: 'boolean' },
      { key: 'spar', label: '允许 bot 对线', help: '开启后仍受下方频率限制。', type: 'boolean' },
      { key: 'detect', label: '启用检测', help: '记录实验中观察到的注入迹象。', type: 'boolean' },
      { key: 'alertWindowMs', label: '重复告警合并窗口（毫秒）', help: '同一时间窗口内的重复告警合并处理。', type: 'number', min: 1000 },
      { key: 'sparPerHour', label: '每小时最多对线次数', help: '限制实验工具的触发频率。', type: 'number', min: 0, max: 60 }
    ] };
