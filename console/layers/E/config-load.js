import { renderAdminPresets } from './admin-presets.js';

// Apply only the E-layer configuration fields.
export function applyEConfig(c) {
const ad = c.adminDev || {};
document.getElementById('v2AdminDevEnabled').checked = ad.enabled === true;
renderAdminPresets(ad.preset === 'qq-chat-dev' ? '' : String(ad.preset ?? ''));
}
