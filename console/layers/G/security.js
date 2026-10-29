
import { api } from '../../shared/api.js';
export function formatSecurityRules(rules, title) {
  const entries = Array.isArray(rules) ? rules : [];
  return `【${title}】\n` + (entries.length
    ? entries.map(rule => `• ${rule.enabled === false ? '停用' : '启用'}｜${rule.label || rule.id || '未命名规则'}\n  正则表达式：${rule.pattern || ''}\n  flags：${rule.flags || '（无）'}`).join('\n')
    : '（无规则）');
}
export function formatSecurityPolicy(security, guard = {}) {
  const terms = (value) => Array.isArray(value) && value.length ? value.join('、') : '无';
  return [
    `入站防护总开关：${guard.enabled === false ? '停用' : '启用'}；命中注入规则：${guard.quarantineInjection === false ? '不隔离' : '隔离并标记'}；命中违禁规则：${guard.blockForbidden === false ? '不拒收' : '拒收'}`,
    formatSecurityRules(security.sensitiveRules, '出站泄漏检测'),
    `补充出站敏感词：${terms(security.extraSensitiveTerms)}`,
    formatSecurityRules(security.injectionRules, '入站提示词注入检测'),
    formatSecurityRules(security.forbiddenRules, '入站违禁内容检测'),
    `补充入站拦截词：${terms(security.extraForbiddenTerms)}`,
    '已知会话令牌：固定精确匹配保护（独立于上述可配置规则）。'
  ].join('\n\n');
}
export function loadSecurity() {
  api('/api/security').then(r => {
    const security = r.security || {};
    document.getElementById('secInterceptNotify').checked = security.interceptNotify !== false;
    document.getElementById('secInterceptText').value = security.interceptNotifyText || '⚠️ 本条回复因疑似包含敏感信息（路径/凭据/会话令牌）被安全策略拦截，已记录并通知管理员。';
    document.getElementById('secSecurityPolicy').textContent = formatSecurityPolicy(security, r.guardSettings || {});
    // state/ 的 ACL 是否收紧（Windows 上需要管理员权限，未提权时会失败）。
    // 明确警示 + 给出可复制的命令，而不是让用户以为已经安全。
    const warn = document.getElementById('stateDirWarn');
    const hardened = r.stateDir?.hardened;
    if (hardened === false) {
      document.getElementById('stateDirPath').textContent = r.stateDir?.path || 'state/';
      document.getElementById('stateDirCmd').textContent = r.stateDir?.manualCommand || '';
      warn.style.display = '';
    } else {
      warn.style.display = 'none';
    }
  }).catch(() => {});
}
export async function saveSecurityPayload(payload, button, msg) {
  button.disabled = true;
  msg.textContent = '保存中…';
  msg.className = 'meta';
  try {
    const r = await api('/api/security', 'POST', payload);
    if (!r.ok) throw new Error(r.error || '保存失败');
    msg.textContent = '✅ 已保存';
    msg.className = 'meta ok';
  } catch (error) {
    msg.textContent = '❌ ' + error.message;
    msg.className = 'meta err';
  } finally {
    button.disabled = false;
  }
}
export async function saveSecurityField(field, value, button, msg) {
  return saveSecurityPayload({ [field]: value }, button, msg);
}
export function initialize() {
document.getElementById('secInterceptNotifySave').addEventListener('click', () => saveSecurityField(
  'interceptNotify', document.getElementById('secInterceptNotify').checked,
  document.getElementById('secInterceptNotifySave'), document.getElementById('secInterceptNotifyMsg')
));
document.getElementById('secInterceptTextSave').addEventListener('click', () => saveSecurityField(
  'interceptNotifyText', document.getElementById('secInterceptText').value.trim(),
  document.getElementById('secInterceptTextSave'), document.getElementById('secInterceptTextMsg')
));
document.getElementById('stateDirReharden').addEventListener('click', async () => {
  const msg=document.getElementById('stateDirMsg');msg.textContent='检测中…';
  try{const r=await api('/api/security');const ok=r.stateDir?.hardened===true;msg.textContent=ok?'权限已收紧':'权限尚未收紧；请按上方命令处理后复检';msg.className=ok?'meta ok':'meta err';await loadSecurity();}
  catch(error){msg.textContent='检查失败：'+error.message;msg.className='meta err';}
});
}
