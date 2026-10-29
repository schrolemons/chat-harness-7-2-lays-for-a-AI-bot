import { buildWakeGuidance } from '../life-wake-reasons/guidance.js';
// ctx-context-lifecycle（C/L 层｜唤醒/节奏/收尾提示）
//
// 从 buildWakePromptV2 搬走：
//   · 唤醒状态【当前唤醒】/【这是你主动开口】
//   · 首回复节奏【首回复节奏】/【主动开口·不是回复】
//   · 沉睡前观察【沉睡前强制等待】
//   · 【刚解除静音】
//   · 【到点提醒｜别忘了】
//
// 桥接只负责触发事实与副作用（清 pendingReminderItems、清 mutedJustCleared、算 replyTiming/preSleepMs），
// 文案全部在组件里。

function buildWakeLine(st, autonomousNow, hasUnreadNow) {
  if (autonomousNow && !hasUnreadNow) return '【这是你主动开口】不是被谁叫醒、也不是在回谁。';
  const wc = st?.wakeConfig || {};
  const tr = wc.triggers || {};
  const mode = wc.mode === 'active' ? '活跃' : '潜水';
  const time = wc.infinite ? '无限' : (wc.sleepUntil && Number.isFinite(Date.parse(wc.sleepUntil)) ? '有限至 ' + new Date(wc.sleepUntil).toLocaleString() : '未设时间');
  const triggers = [];
  if (tr.atMention) triggers.push('@');
  if (tr.nameMention) triggers.push('名字');
  if (Array.isArray(tr.keywords) && tr.keywords.length) triggers.push('关键词');
  if (tr.question) triggers.push('提问');
  if (tr.poke) triggers.push('拍一拍');
  if (Array.isArray(tr.speakerIds) && tr.speakerIds.length) triggers.push(`指定成员(${tr.speakerIds.length}:${tr.speakerIds.join(',')})`);
  if (tr.anyMessage) triggers.push('任意消息');
  if (Number(tr.probability) > 0) triggers.push(`概率${tr.probability}`);
  return `【当前唤醒】${mode}，${time}${triggers.length ? `；触发：${triggers.join('/')}` : ''}`;
}

function buildReplyLine(payload) {
  const timing = payload.replyTiming || {};
  const quietMs = Number(timing.quietMs) || 8000;
  const remaining = Math.max(0, Number(timing.remainingQuietMs) || 0);
  if (payload.autonomousNow && !payload.hasUnreadNow) {
    return '【主动开口·不是回复】这一轮是你自己到点/想说话，**不是回复任何人**：不要用“你按/你戳/你说/你刚才/你问我/你发的”这类接话口吻，不要假装对方刚发过消息，也不要复述旧话题。直接说你此刻想说的那 1 句（可配 1 张贴语境表情）；说完继续潜水，不需要等对方回复。';
  }
  return `【首回复节奏】先处理已有消息，完整的问题及时回答。需要确认对方是否继续补充时，用 qq_wait_for_messages(purpose="reply", quietMs=${quietMs})；从最后来信计时，合批和读提示词的耗时也算，目前还差约 ${Math.ceil(remaining / 1000)} 秒静默。已安静够久可直接回，工具也会立即返回并补上思考期间的新消息。只有明确没说完、你确实要等下文时，才用普通 messages 长等待。`;
}

function buildPreSleepLine(preSleepMs) {
  const ms = Math.max(0, Number(preSleepMs) || 300000);
  return `【沉睡前强制等待】这是决定潜水收尾时的步骤，不是首回复的前置条件。除非对方明确说“不聊了/晚安/下了/拜拜”等结束语，否则每次设置潜水/下一次唤醒前，必须先调用 qq_wait_for_messages(timeoutMs=${ms}) 完成一次沉睡前观察；回复前 purpose="reply" 的短静默不能代替这次完整观察。若 ${Math.round(ms / 60000)} 分钟内没人说话，返回 preSleepWaitSatisfied=true，可以设置下一次唤醒并沉睡；若期间有人发新消息，先查看返回的 newMessages——判断不需要你参与就可以直接沉睡，若你选择参与回复，则下次想睡时需要重新等待观察窗口。【不要靠猜】：等待返回里的 canSleepNow/hint 就是闸门的判断结果——canSleepNow=true 立刻收尾（mark_read 或 set_wake_config）；false 时按 hint 给出的 timeoutMs 一次等满，别用更短的 timeoutMs 去凑（更短的等待不算观察，只会白等一轮）。`;
}

function buildReminderLine(items, key = '') {
  if (!Array.isArray(items) || !items.length) return '';
  // 隐私硬约束：日程只属于登记它的会话。私聊日程只在私聊说，绝不引导到群里。
  const isGroup = String(key || '').startsWith('group:');
  const where = isGroup ? '在群里提醒（说清时间/地点/内容，别复述系统提示）' : '在当前私聊提醒主人本人（说清时间/地点/内容）；这是他自己的日程，不要发到群里或转告其他会话';
  return `【到点提醒｜别忘了】以下日程到点了，这一轮${where}：\n`
    + items.map((it) => '- ' + String(it?.text || it || '').slice(0, 200)).join('\n');
}

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  const disabled = new Set(Array.isArray(cfg.disabledBlocks) ? cfg.disabledBlocks.map(String) : []);
  const on = (name) => !disabled.has(name);

  function buildWakeReminder(payload = {}) {
    const name = String(payload.selfName || '').trim();
    const id = String(payload.selfId || '').trim();
    const label = name ? `「${name}」` : '（昵称未取到）';
    const idText = id ? `（QQ ${id}）` : '';
    const identity = name || id
      ? `【你的身份】你在 QQ 上的昵称是${label}${idText}。消息里出现「@${name}」、有人叫「${name}」、或引用你的消息，指的都是你 —— 不要当成别人；群名片可能与昵称不同，at/引用段里带${id ? ` ${id} ` : '你的 QQ 号'}就是在叫你。\n\n`
      : '';
    const roleName = String(payload.roleName || '');
    const roleLine = roleName ? `【当前角色】${roleName}（完整角色卡请调用 qq_get_prompt 查看）\n\n` : '';
    const token = String(payload.agentToken || '');
    const tokenLine = token ? `【会话令牌】${token}（调用二代状态工具时请在参数中带上此令牌）\n\n` : '';
    const preSleepMs = Math.max(0, Number(payload.preSleepMs) || 300000);
    return `${roleLine}${identity}${tokenLine}【提醒】你还没有完成回合收尾。请调用 qq_set_wake_config 设置下一次唤醒条件（例如继续潜水多久、@/名字/关键词/提问/概率/指定成员等），或者调用 qq_mark_read 表示你看过且决定不接。这是为了防止你忘记收尾后进入“永眠”。注意：设置潜水前先用 qq_wait_for_messages(timeoutMs=${preSleepMs}) 完成沉睡前观察；等待期间有人说话时查看 newMessages，判断不需要你参与即可收尾。`;
  }

  return {
    services: {
      lifecycle: {
        wakeReminder(payload = {}) { return buildWakeReminder(payload); },
        wakeGuidance({wake = {}, proactive = null} = {}) { return buildWakeGuidance(wake, proactive); }
      }
    },
    hooks: {
      beforePrompt(payload = {}) {
        if (/^(memoryWrite|selfReview|selfOptimize|slangLearn)$/.test(String(payload?.reason||''))) return '';
        ctx.addPromptBlock(buildWakeGuidance(payload.wakeConfig || {}, payload.proactivePolicy || null));
        if (on('muted') && payload.mutedJustClearedNow) {
          ctx.addPromptBlock('【刚解除静音】对方之前说过忙/别吵/等会再聊，现在他主动找你。可以正常回，但简短一点，别提“你刚才说忙”，也别借机多聊；对方没叫你时不要再主动搭话。');
        }
        if (on('reminders')) {
          const line = buildReminderLine(payload.pendingRemindersNow, payload.key);
          if (line) ctx.addPromptBlock(line);
        }
        if (on('reply')) ctx.addPromptBlock(buildReplyLine(payload));
        if (on('wake')) ctx.addPromptBlock(buildWakeLine(payload.st, payload.autonomousNow, payload.hasUnreadNow));
        if (on('preSleep')) ctx.addPromptBlock(buildPreSleepLine(payload.preSleepMs));
        return '';
      }
    }
  };
}
