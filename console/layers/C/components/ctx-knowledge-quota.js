
export default {saveLabel:"保存专业问答配额", title: '专业问答配额规则', fields: [
      { key: 'enabled', label: '启用配额规则', help: '关闭后专业问题不再计数，也不会因达到上限而被拦截；配额查询工具仍可查看已有记录。', type: 'boolean' },
      { key: 'dailyLimit', label: '每个计数对象每日可回答次数', help: '达到此次数后，后续命中的专业问题会改为使用下方的自然带过提示。设为 0 表示不允许额度内回答。', type: 'number', min: 0, max: 1000 },
      { key: 'resetHour', label: '每日重置时间（小时）', help: '按桥接所在时区重置每日计数。填 0 表示午夜重置；填 4 表示每天凌晨 4 点重置。', type: 'number', min: 0, max: 23 },
      { key: 'exemptOwner', label: '主人不受配额限制', help: '开启后，主人发起的专业问题不计入配额，也不会被配额拦截。', type: 'boolean' },
      { key: 'countBy', label: '配额计数方式', help: 'session：同一群或私聊共用额度；user：群内每位发言者各自计算，私聊仍按会话计算。', type: 'select', options: ['session', 'user'] },
      { key: 'deflectText', label: '超额时实际发送的短句', help: '超额后直接发送这句话，停止本条请求的模型调度。最多 120 字；空白使用默认短句。', type: 'textarea' },
      { key: 'keywords', label: '专业问题关键词（逗号分隔）', help: '领域关键词结合问句、解释、推导、编写等明确请求识别；普通的论文或代码话题闲聊不计数。匹配不区分英文大小写。', type: 'comma-list' }
    ] };
