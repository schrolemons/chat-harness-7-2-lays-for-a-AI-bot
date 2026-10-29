
export default {
      title: '监控设置',
      fields: [
        { key: 'webWatchEnabled', label: '启用网页监控', help: '必须填写至少一个网址；页面变化时发送新增内容的 diff。', type: 'boolean' },
        { key: 'fastCheckMinutes', label: '到期轮询间隔（分钟）', help: '只检查哪些任务到期，不表示每次都抓取网页或讲座。', type: 'number', min: 1, max: 1440 },
        { key: 'fullCheckMinutes', label: '普通网页完整检查间隔（分钟）', help: '普通 watchUrls 的完整抓取周期；讲座检查使用其独立周期。', type: 'number', min: 1, max: 10080 },
        { key: 'watchUrls', label: '监控网址（勾选=启用）', help: '所有网页都按普通网址监控处理，含 Blackboard 页面。可直接写 https://网址，也可写“名称 | https://网址”；取消勾选 = 暂停检测但保留。', type: 'items', placeholder: '名称 | https://网址', addLabel: '添加网址' },
        { key: 'scriptCollabEnabled', label: '启用脚本协同', help: '添加脚本后，AI 可以按约定查询其状态并参与任务流程。', type: 'boolean' },
        { key: 'scriptPaths', label: '协同脚本（勾选=启用）', help: '每行：勾选框 = 是否协同。例如 scripts/campus-watch.mjs。绿灯由脚本写入运行心跳后显示；只填路径不会自动执行脚本。', type: 'items', placeholder: 'scripts/campus-watch.mjs', addLabel: '添加脚本' },
        { key: 'enabledScripts', label: '内置协同任务标识（高级）', type: 'text', group: '高级接口' },
        { key: 'lecturesApi', label: '讲座查询接口（高级）', type: 'json' },
        { key: 'lecturesEnabled', label: '启用抢讲座', type: 'boolean' },
        { key: 'lecturesLocation', label: '讲座地点关键词', help: '例如「高新」。', type: 'text' },
        { key: 'lecturesIntervalMinutes', label: '讲座实际检查周期（分钟）', type: 'number', min: 1, max: 120 },
        { key: 'lecturesPortalUrl', label: '讲座门户 URL', type: 'text' }
      ]
    };
