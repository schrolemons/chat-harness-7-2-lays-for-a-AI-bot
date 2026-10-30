
export default {saveLabel:"保存浏览器操作规则",
      title: '浏览器设置',
      fields: [
        { key: 'allowUrls', label: '允许访问的网址（每行一个）', help: '留空表示不限定。当前用于告知 AI 访问范围。', type: 'lines' },
        { key: 'blockUrls', label: '禁止访问的网址（每行一个）', help: '优先于允许列表；当前用于告知 AI 避开这些地址。', type: 'lines' },
        { key: 'headlessFor', label: '无头运行的场景', help: '匹配这些任务用途时不显示浏览器窗口；多个用途用 | 分隔。', type: 'text' },
        { key: 'visibleFor', label: '显示窗口的场景', help: '匹配登录、验证码等需要人工操作的用途时显示窗口；多个用途用 | 分隔。', type: 'text' },
        { key: 'rules', label: '浏览器操作与监控规则（每行一条）', help: '供浏览器任务和监控共同参考，不只影响某一个网址；不替代实际权限检查。', type: 'lines' }
      ]
    };
