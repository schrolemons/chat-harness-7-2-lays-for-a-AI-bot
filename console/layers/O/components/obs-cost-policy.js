
export default {saveLabel:"保存模型调用档位",
      title: '成本策略（调用档位）',
      fields: [
        { key: 'autoUpgradeComplexTasks', label: '复杂任务自动升级 Pro（关闭后仅明确指定升级）', type: 'boolean' },
        { key: 'defaultModel', label: '默认模型', type: 'select', options: ['deepseek-flash', 'deepseek-v4-pro'] },
        { key: 'defaultEffort', label: '默认思考强度', type: 'select', options: ['low', 'medium', 'high', 'max'] },
        { key: 'upgradeModel', label: '升级模型（复杂任务/明确指定）', type: 'select', options: ['deepseek-flash', 'deepseek-v4-pro'] },
        { key: 'upgradeEffort', label: '升级思考强度', type: 'select', options: ['low', 'medium', 'high', 'max'] }
      ]
    };
