// Bridge roles have fixed protocols; model and effort remain independently configurable.
export const FIXED_PRESETS = Object.freeze({chat:'qq-chat', reserved:'qq-chat', reserved2:'qq-chat-v2', learning:'qq-learning', task:'qq-task-worker', summary:'campus-summary'});
export function adminPresetConfig(config = {}) {
  return { enabled: config.enabled === true, preset: 'qq-admin' };
}
export function requestedPreset({mode, owner = false, admin = {}}) {
  const binding = adminPresetConfig(admin);
  if (owner && binding.enabled) return {id:binding.preset, strict:!!binding.preset};
  return {id:FIXED_PRESETS[mode] || FIXED_PRESETS.chat, strict:true};
}
export function simulationPreset(mode) { return mode === 'reserved2' ? FIXED_PRESETS.reserved2 : mode === 'reserved' || mode === 'chat' ? FIXED_PRESETS.chat : null; }
