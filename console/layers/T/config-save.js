
// Collect only the T-layer configuration fields.
export function collectTConfig() { return {
tools: Object.fromEntries([...document.querySelectorAll('[data-v2-tool]')].map(el=>[el.dataset.v2Tool,el.checked]))
}; }
