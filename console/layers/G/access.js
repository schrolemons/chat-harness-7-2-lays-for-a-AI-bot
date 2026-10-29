
import { api } from '../../shared/api.js';
// layers/G/access: explicit imports; initialize is called in the application startup order.

async function refreshWhitelist() {
  try {
    const w = await api('/api/whitelist');
    document.getElementById('wlGroups').value = (w.allow.groups || []).join(', ');
    document.getElementById('wlPrivate').value = (w.allow.private || []).join(', ');
    document.getElementById('ownerQQ').value = w.ownerQQ != null ? String(w.ownerQQ) : '';
    document.getElementById('dnGroups').value = (w.deny.groups || []).join(', ');
    document.getElementById('dnPrivate').value = (w.deny.private || []).join(', ');
  } catch {}
}

export function initialize() {

}
export { refreshWhitelist };
