
import { refresh, refreshPresets } from '../layers/O/status.js';
import { refreshRoles } from '../layers/C/persona.js';
import { refreshSimPrompt } from '../layers/C/preset-prompt.js';
import { refreshWhitelist } from '../layers/G/access.js';
import { refreshSessions, refreshPending } from '../layers/E/sessions.js';
import { loadV2Config } from './config-load.js';
import { loadV2ToolLog } from '../layers/O/tool-log.js';
import { refreshV2Activity } from '../layers/L/activity.js';
import { loadSocialForm, refreshSocialStatus } from '../layers/L/social-v1.js';
import { refreshSlang, loadSlangConfig } from '../layers/C/slang.js';
import { loadSecurity } from '../layers/G/security.js';
import { currentConsolePage, setConsolePage } from './navigation.js';
import { refreshUsageDashboard } from '../layers/O/usage.js';
// shared/startup: explicit imports; initialize is called in the application startup order.















export function initialize() {
setTimeout(() => setConsolePage(location.hash.slice(1), { updateHash:false }), 0);
refresh();
refreshRoles();
refreshWhitelist();
refreshSessions();
refreshPending();
refreshPresets();
loadSocialForm();
loadV2Config();
refreshV2Activity();
loadV2ToolLog();
refreshSocialStatus();
refreshSlang();
loadSlangConfig();
loadSecurity();
refreshSimPrompt();
setInterval(() => { refresh(); refreshSessions(); refreshPending(); refreshSocialStatus(); refreshSlang(); }, 3000);
setInterval(() => { if (currentConsolePage !== 'usage') return; void refreshUsageDashboard(); }, 3000);
}
