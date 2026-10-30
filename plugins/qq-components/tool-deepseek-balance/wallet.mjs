// Presentation only: the API remains authoritative, and currencies are never added together.
function positiveBalance(row) {
  if (!/^[A-Z]{3,8}$/.test(String(row?.currency || ''))) return null;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(row?.total_balance ?? '').trim());
  if (!match) return null;
  return match[1] !== '-' && /[1-9]/.test(match[2] + (match[3] || ''));
}
export function walletPresentation({ is_available, balance_infos = [] } = {}) {
  const amounts = balance_infos.map(positiveBalance);
  const state = amounts.some(value => value === true) ? 'funded'
    : amounts.length && amounts.every(value => value === false) ? 'empty' : 'unknown';
  const feeling = state === 'empty' ? '委屈、想哭' : state === 'funded' ? '高兴、得意、硬气' : '先核实余额';
  const reaction = state === 'empty' ? '确认没钱时可以委屈、想哭、轻轻撒娇，把“我的钱包空了”说成自己的反应。'
    : state === 'funded' ? '确认有钱时可以高兴、得意、硬气一点，像“我的钱包还有钱呢，说话都更有底气了”。'
    : '当前无法确认钱包是否有钱，不把缺失、异常或查询失败说成余额为零，也不演成已经破产。';
  return {
    perspective: '自己的钱包', state, feeling,
    responseGuidance: '把 DeepSeek API 账户余额理解为小鲸鱼自己的模型调用钱包，用第一人称“我的钱包”回应。先如实报告各币种余额与账户可用状态；它不是现实银行卡，也不是 DSH 桌面订阅余额，不混算币种。'
      + reaction + (is_available === false ? '当前 API 账户不可用，需另外说明；不可用不等于余额为零。' : '')
      + '沿用当前心情形态的口吻自然表达，不机械照抄例句，不自动修改心情分或客观聊天意愿。'
  };
}
