// Operational details and delegated execution belong only to the authenticated owner private session.
const CHAT_ONLY_PRESETS=new Set(['qq-chat','qq-chat-v2','qq-learning','campus-summary']);
export function isAdminEnvironmentAuthorized({owner=false,enabled=false,selectedPreset='',loadedPreset='',hasSession=false,knownPresets=[],requireSession=true,presetMap={}}={}) {
  const canonical=Object.entries(presetMap).find(([,id])=>id===selectedPreset)?.[0] || selectedPreset;
  return owner===true && enabled===true && !!selectedPreset && !CHAT_ONLY_PRESETS.has(selectedPreset) && !CHAT_ONLY_PRESETS.has(canonical)
    && knownPresets.includes(selectedPreset) && (!requireSession || hasSession && loadedPreset===selectedPreset);
}
export function isAdminPluginTool(name) {
  return /^(?:task_(?:spawn|list|result|input|cancel)|web_watch_status$|bridge_health_|user_checking$|worklog_|diary_|eval_|exec_|browser_policy$|env_bridge_|integration_|gov_policy_|image_generation_(?:secret|status)$)/.test(String(name || ''));
}
export function isAdminToolName(name) {
  const value=String(name || '');
  if (/^mcp__(?:snowluma-host|bridge-health|codex-peer|playwright)__/.test(value)) return true;
  const raw=value.split('__').at(-1);
  if (['qq_send_file','snowluma_status','bridge_health'].includes(raw)) return true;
  return isAdminPluginTool(raw) || isAdminPluginTool(raw.replace(/^qq_/,''));
}
