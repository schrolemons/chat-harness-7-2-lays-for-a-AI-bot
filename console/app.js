import { initialize as initSessionOptions } from './shared/session-options.js';
import {initialize as initProactivePreview} from './layers/L/proactive-preview.js';
import { initialize as initterms } from './layers/C/terms.js';
import { initialize as initaffairs } from './layers/C/affairs.js';
import { initialize as initsessionToken } from './layers/G/session-token.js';
import { initialize as initsecurity } from './layers/G/security.js';
import { initialize as initV } from "./layers/V/page.js";
import { initialize as initS } from "./layers/S/page.js";
import { initialize as init0 } from "./shared/api.js";
import { initialize as init1 } from "./layers/T/games.js";
import { initialize as init2 } from "./layers/O/status.js";
import { initialize as init3 } from "./layers/C/persona.js";
import { initialize as init4 } from "./layers/C/preset-prompt.js";
import { initialize as init5 } from "./layers/O/model-status.js";
import { initialize as init6 } from "./layers/G/access.js";
import { initialize as init7 } from "./layers/E/sessions.js";
import { initialize as init8 } from "./layers/C/preset-actions.js";
import { initialize as init9 } from "./layers/C/persona-actions.js";
import { initialize as init10 } from "./layers/O/model-actions.js";
import { initialize as init11 } from "./layers/E/voice.js";
import { initialize as init12 } from "./layers/L/time-bubbles.js";
import { initialize as init13 } from "./layers/C/persistent-memory.js";
import { initialize as init14 } from "./layers/O/diary.js";
import { initialize as init15 } from "./layers/O/diary-history.js";
import { initialize as init16 } from "./layers/L/schedule.js";
import { initialize as init17 } from "./layers/C/mood.js";
import { initialize as init18 } from "./shared/config-load.js";
import { initialize as init19 } from "./layers/O/self-review.js";
import { initialize as init20 } from "./shared/config-save.js";
import { initialize as init21 } from "./layers/L/session-state.js";
import { initialize as init22 } from "./layers/O/tool-log.js";
import { initialize as init23 } from "./layers/C/light-memory.js";
import { initialize as init24 } from "./layers/L/wake-status.js";
import { initialize as init25 } from "./layers/C/initial-prompt.js";
import { initialize as init26 } from "./layers/L/activity.js";
import { initialize as init27 } from "./layers/L/receipts.js";
import { initialize as init28 } from "./layers/O/feedback.js";
import { initialize as init29 } from "./layers/O/optimization-summary.js";
import { initialize as init30 } from "./layers/L/social-v1.js";
import { initialize as init31 } from "./layers/C/slang.js";
import { initialize as init32 } from "./shared/navigation.js";
import { initialize as init33 } from "./shared/accessibility.js";
import { initialize as init34 } from "./layers/O/usage-chart.js";
import { initialize as init35 } from "./layers/O/usage.js";
import { initialize as init36 } from "./shared/icons.js";
import { initialize as init37 } from "./shared/config-actions.js";
import { initialize as init38 } from "./shared/startup.js";
import { initialize as init39 } from "./shared/theme.js";
import { initialize as init40 } from "./shared/component-renderer.js";
import { initialize as init41 } from "./layers/R/registry.js";
import { initialize as init43 } from "./layers/C/learning-common.js";
import { initialize as init44 } from "./layers/C/aliases.js";
import { initialize as init45 } from "./layers/E/environment-components.js";
import { initialize as init46 } from "./layers/L/availability.js";
import { api } from './shared/api.js';
init0(); // shared/api
initProactivePreview();
init1(); // layers/T/games
init2(); // layers/O/status
init3(); // layers/C/persona
init4(); // layers/C/preset-prompt
init5(); // layers/O/model-status
init6(); // layers/G/access
init7(); // layers/E/sessions
init8(); // layers/C/preset-actions
init9(); // layers/C/persona-actions
init10(); // layers/O/model-actions
init11(); // layers/E/voice
init12(); // layers/L/time-bubbles
init13(); // layers/C/persistent-memory
initaffairs(); // C owns affair editing and preview
init14(); // layers/O/diary
init15(); // layers/O/diary-history
init16(); // layers/L/schedule
init17(); // layers/C/mood
init18(); // shared/config-load
init19(); // layers/O/self-review
init20(); // shared/config-save
init21(); // layers/L/session-state
init22(); // layers/O/tool-log
init23(); // layers/C/light-memory
init24(); // layers/L/wake-status
init25(); // layers/C/initial-prompt
init26(); // layers/L/activity
init27(); // layers/L/receipts
init28(); // layers/O/feedback
init29(); // layers/O/optimization-summary
init30(); // layers/L/social-v1
init31(); // layers/C/slang
init32(); // shared/navigation
init33(); // shared/accessibility
init34(); // layers/O/usage-chart
init35(); // layers/O/usage
init36(); // shared/icons
init37(); // shared/config-actions
init38(); // shared/startup
init39(); // shared/theme
init40(); // shared/component-renderer
init41(); // layers/R/registry
init43(); // layers/C/learning-common
init44(); // layers/C/aliases
init45(); // layers/E/environment-components
init46(); // layers/L/availability

initV();
initS();

initsecurity();

initsessionToken();

initterms();
import './styles.css';

initSessionOptions();
