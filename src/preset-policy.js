// Dedicated workers keep their protocol and tool boundaries; only the owner binding is selectable.
export const FIXED_PRESETS = Object.freeze({chat:'qq-chat', reserved:'qq-chat', reserved2:'qq-chat-v2', learning:'qq-learning', task:'qq-task-worker', summary:'campus-summary'});
export function adminPresetConfig(config = {}, legacyPreset = '') {
  const value = config.preset;
  return { enabled: config.enabled === true, preset: String(value === undefined || value === 'qq-chat-dev' ? legacyPreset : value).trim() };
}
export function requestedPreset({mode, owner = false, admin = {}}) {
  const binding = adminPresetConfig(admin);
  if (owner && (mode === 'closed-agent' || binding.enabled)) return {id:binding.preset, strict:false};
  return {id:FIXED_PRESETS[mode] || FIXED_PRESETS.chat, strict:true};
}
export function simulationPreset(mode) { return mode === 'reserved2' ? FIXED_PRESETS.reserved2 : mode === 'reserved' || mode === 'chat' ? FIXED_PRESETS.chat : null; }
