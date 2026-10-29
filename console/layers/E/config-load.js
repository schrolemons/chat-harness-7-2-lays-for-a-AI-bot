
// Apply only the E-layer configuration fields.
export function applyEConfig(c) {
const ad = c.adminDev || {};
document.getElementById('v2AdminDevEnabled').checked = ad.enabled !== false;
document.getElementById('v2AdminDevPreset').value = ad.preset || 'qq-chat-dev';
}
