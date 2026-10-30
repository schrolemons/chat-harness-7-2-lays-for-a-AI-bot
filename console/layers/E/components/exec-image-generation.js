
export default {saveLabel:"保存生图服务与额度",
      title: '图片生成设置',
      fields: [
        { key: 'apiBase', label: 'OpenAI API 地址', help: '兼容 OpenAI 图片接口的服务地址。', type: 'text' },
        { key: 'proxyUrl', label: '网络代理（可选）', help: '例如 http://127.0.0.1:7897；留空则读取系统代理环境变量。只用于生图供应商请求。', type: 'text' },
        { key: 'model', label: 'OpenAI 模型', type: 'text' },
        { key: 'size', label: 'OpenAI 图片尺寸', help: '例如 1024x1024，以服务商支持的尺寸为准。', type: 'text' },
        { key: 'quality', label: 'OpenAI 画质档位', help: '以服务商支持的值为准。', type: 'text' },
        { key: 'quotaMode', label: '每日额度模式', help: 'global 全局；session 每个会话；both 同时限制。按上海时间每天重置。', type: 'select', options: ['global', 'session', 'both'] },
        { key: 'dailyGlobalLimit', label: '全局每日请求上限', type: 'number', min: 0, max: 10000 },
        { key: 'dailySessionLimit', label: '每个会话每日请求上限', type: 'number', min: 0, max: 10000 },
        { key: 'maxPromptChars', label: '提示词最大字符数', type: 'number', min: 1, max: 10000 },
        { key: 'maxReferenceImages', label: '最多引用图片数', type: 'number', min: 0, max: 5 },
        { key: 'maxReferenceBytes', label: '单张引用图片最大字节数', type: 'number', min: 1, max: 30000000 },
        { key: 'maxOutputBytes', label: '生成图片最大字节数', type: 'number', min: 1, max: 30000000 },
        { key: 'timeoutSeconds', label: '请求超时（秒）', type: 'number', min: 1, max: 600 },
        { key: 'cooldownSeconds', label: '同一会话冷却（秒）', type: 'number', min: 0, max: 3600 },
        { key: 'allowAutomatic', label: '允许按聊天语境自动生成图片', help: '开启后仍受会话权限、额度和冷却限制。', type: 'boolean' },
        { key: 'allowedSessions', label: '允许使用的会话（每行一个）', help: '例如 private:12345 或 group:67890。', type: 'lines' },
        { key: 'assetRetentionDays', label: '生成图片保留天数', type: 'number', min: 1, max: 365 }
      ]
    };
