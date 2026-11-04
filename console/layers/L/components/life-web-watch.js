
export default {
      title: '监控设置',
      fields: [
        { key: 'webWatchEnabled', label: '启用网页监控', help: '必须填写至少一个网址；页面变化时发送新增内容的 diff。', type: 'boolean' },
        { key: 'fastCheckMinutes', label: '到期轮询间隔（分钟）', help: '只检查哪些网址到期，不表示每次都重新读取全部网页。', type: 'number', min: 1, max: 1440 },
        { key: 'fullCheckMinutes', label: '网页完整检查间隔（分钟）', help: '按此间隔重新读取已启用的网址，并与上次内容比较。', type: 'number', min: 1, max: 10080 },
        { key: 'loginMaxAttempts', label: '登录尝试／通知上限（次）', help: '全局上限、各网站独立计数。同一来源共用一次登录。例：设3，第3次失败时QQ通知并暂停，等待手动重新监管或桥接重启。', type: 'number', min: 1, max: 20 },
        { key: 'loginRetryMinutes', label: '登录尝试／提醒间隔（分钟）', help: '尝试与提醒共用这一间隔。例：设5，首次失败立即通知，之后每5分钟验证一次；每次失败立即通知。', type: 'number', min: 1, max: 1440 },
        { key: 'watchUrls', label: '监控网址（勾选=启用）', help: '所有网页都按普通网址监控处理。可直接写 https://网址，也可写“名称 | https://网址”；取消勾选 = 暂停检测但保留。', type: 'items', placeholder: '名称 | https://网址', addLabel: '添加网址' },
        { key: 'scriptCollabEnabled', label: '启用脚本协同', help: '添加脚本后，AI 可以按约定查询其状态并参与任务流程。', type: 'boolean' },
        { key: 'scriptPaths', label: '协同脚本（勾选=启用）', help: '勾选参与协同，取消勾选暂停。登记地址不会自动执行脚本。', type: 'items', placeholder: '填写脚本路径', addLabel: '添加脚本' }
      ]
    };
