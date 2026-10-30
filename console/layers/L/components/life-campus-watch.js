
export default {
      title: '监控设置',
      fields: [
        { key: 'webWatchEnabled', label: '启用网页监控', help: '必须填写至少一个网址；页面变化时发送新增内容的 diff。', type: 'boolean' },
        { key: 'fastCheckMinutes', label: '到期轮询间隔（分钟）', help: '只检查哪些网址到期，不表示每次都重新读取全部网页。', type: 'number', min: 1, max: 1440 },
        { key: 'fullCheckMinutes', label: '网页完整检查间隔（分钟）', help: '按此间隔重新读取已启用的网址，并与上次内容比较。', type: 'number', min: 1, max: 10080 },
        { key: 'watchUrls', label: '监控网址（勾选=启用）', help: '所有网页都按普通网址监控处理，含 Blackboard 页面。可直接写 https://网址，也可写“名称 | https://网址”；取消勾选 = 暂停检测但保留。', type: 'items', placeholder: '名称 | https://网址', addLabel: '添加网址' },
        { key: 'scriptCollabEnabled', label: '启用脚本协同', help: '添加脚本后，AI 可以按约定查询其状态并参与任务流程。', type: 'boolean' },
        { key: 'scriptPaths', label: '协同脚本（勾选=启用）', help: '勾选参与协同，取消勾选暂停。登记地址不会自动执行脚本。', type: 'items', placeholder: 'scripts/campus-watch.mjs', addLabel: '添加脚本' },
        { key: 'enabledScripts', label: '内置协同任务标识（高级）', type: 'text', group: '高级接口' },
        { key: 'lecturesApi', label: '讲座查询接口（高级）', type: 'json' },
        { key: 'lecturesEnabled', label: '启用抢讲座', type: 'boolean' },
        { key: 'lecturesLocation', label: '讲座地点关键词', help: '例如「高新」。', type: 'text' },
        { key: 'lecturesIntervalMinutes', label: '讲座实际检查周期（分钟）', type: 'number', min: 1, max: 120 },
        { key: 'lecturesPortalUrl', label: '讲座门户 URL', type: 'text' }
      ]
    };
