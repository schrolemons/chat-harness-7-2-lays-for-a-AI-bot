import extraForm2 from '../../layers/C/components/ctx-memory-store.js';
import extraForm1 from '../../layers/L/components/life-scheduler.js';
import extraForm0 from '../../layers/T/components/tool-bilibili.js';
import form0 from '../../layers/C/components/tool-user-checking.js';
import form1 from '../../layers/C/components/ctx-memory-profile-store.js';
import form2 from '../../layers/C/components/ctx-knowledge-quota.js';
import form3 from '../../layers/L/components/ctx-chat-reply-shape.js';
import form4 from '../../layers/L/components/ctx-chat-topic-drive.js';
import form5 from '../../layers/E/components/exec-browser-manager.js';
import form6 from '../../layers/E/components/exec-image-generation.js';
import form7 from '../../layers/L/components/life-campus-watch.js';
import form8 from '../../layers/C/components/ctx-media-sticker-pick.js';
import form9 from '../../layers/C/components/ctx-memory-update.js';
import form10 from '../../layers/C/components/ctx-memory-profile-facts.js';
import form11 from '../../layers/C/components/ctx-memory-context.js';
import form12 from '../../layers/O/components/obs-cost-policy.js';
import form13 from '../../layers/L/components/life-relay-message.js';
import form14 from '../../layers/L/components/life-task-session.js';
import form15 from '../../layers/L/components/life-proactive-time-bubble.js';
import form16 from '../../layers/L/components/life-proactive-startup-greeting.js';
import form17 from '../../layers/L/components/life-schedule-reminder.js';
import form18 from '../../layers/L/components/life-user-availability.js';
import form19 from '../../layers/L/components/life-message-ack.js';
import form20 from '../../layers/O/components/obs-health-monitor.js';
import form21 from '../../layers/V/components/eval-regression.js';
import form22 from '../../layers/G/components/gov-policy.js';
import form23 from '../../layers/T/components/tool-injection-lab.js';
import form24 from '../../layers/L/components/life-wake-reasons.js';
import form25 from '../../layers/L/components/life-daily-worklog.js';
import form26 from '../../layers/S/components/personal-core.js';
export const COMPONENT_FORMS = {
  "ctx-memory-store": extraForm2,
  "life-scheduler": extraForm1,
  "tool-bilibili": extraForm0,
  'tool-user-checking': form0,
  'ctx-memory-profile-store': form1,
  'ctx-knowledge-quota': form2,
  'ctx-chat-reply-shape': form3,
  'ctx-chat-topic-drive': form4,
  'exec-browser-manager': form5,
  'exec-image-generation': form6,
  'life-campus-watch': form7,
  'ctx-media-sticker-pick': form8,
  'ctx-memory-update': form9,
  'ctx-memory-profile-facts': form10,
  'ctx-memory-context': form11,
  'obs-cost-policy': form12,
  'life-relay-message': form13,
  'life-task-session': form14,
  'life-proactive-time-bubble': form15,
  'life-proactive-startup-greeting': form16,
  'life-schedule-reminder': form17,
  'life-user-availability': form18,
  'life-message-ack': form19,
  'obs-health-monitor': form20,
  'eval-regression': form21,
  'gov-policy': form22,
  'tool-injection-lab': form23,
  'life-wake-reasons': form24,
  'life-daily-worklog': form25,
  'personal-core': form26
};

import moodForm from '../../layers/C/components/ctx-user-mood.js';
COMPONENT_FORMS['ctx-user-mood'] = moodForm;

import waitCycleForm from '../../layers/L/components/life-conversation-wait.js';
COMPONENT_FORMS['life-conversation-wait'] = waitCycleForm;
