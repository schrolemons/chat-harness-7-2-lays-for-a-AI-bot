
export default {saveLabel:"保存心跳告警设置", title: '运行异常提醒', fields: [{ key: 'staleAlertCooldownMs', label: '重复提醒冷却（毫秒）', help: '同一类异常两次提醒的最短间隔。', type: 'number', min: 60000 }] };
