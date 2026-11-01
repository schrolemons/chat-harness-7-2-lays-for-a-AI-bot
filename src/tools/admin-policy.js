// Operational details and delegated execution belong only to the authenticated owner private session.
export function isAdminPluginTool(name) {
  return /^(?:task_(?:spawn|list|result|input|cancel)|campus_|bridge_health_|user_checking$|worklog_|diary_|eval_|exec_|browser_policy$|env_bridge_|integration_|gov_policy_|image_generation_(?:secret|status)$)/.test(String(name || ''));
}
export function isAdminToolName(name) {
  const value=String(name || '');
  if (/^mcp__(?:snowluma-host|bridge-health|codex-peer|playwright)__/.test(value)) return true;
  const raw=value.split('__').at(-1);
  if (raw === 'qq_send_file') return true;
  return isAdminPluginTool(raw) || isAdminPluginTool(raw.replace(/^qq_/,''));
}
