const guidanceURL=new URL('../life-wake-reasons/guidance.js',import.meta.url);guidanceURL.search=new URL(import.meta.url).search;
const {buildWakeGuidance}=await import(guidanceURL.href);
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
  const time = wc.infinite ? '不另设到时检查' : (wc.sleepUntil && Number.isFinite(Date.parse(wc.sleepUntil)) ? '明确到时唤醒：' + new Date(wc.sleepUntil).toLocaleString() : '未设时间');
  return '【当前唤醒】'+time+'；群聊来信按全局 p+max(q) 单次判定，私聊不抽签。';
}

function buildReplyLine(payload) {
  const timing = payload.replyTiming || {};
  const quietMs = Number(timing.quietMs) || 8000;
  const remaining = Math.max(0, Number(timing.remainingQuietMs) || 0);
  if (payload.autonomousNow && !payload.hasUnreadNow) {
    return '【主动开口·不是回复】这一轮是你自己到点/想说话，**不是回复任何人**：不要用“你按/你戳/你说/你刚才/你问我/你发的”这类接话口吻，不要假装对方刚发过消息，也不要复述旧话题。直接说你此刻想说的那 1 句（可配 1 张贴语境表情）；说完并提交回执后，调用 qq_wait_for_messages 等新互动，按后台 endRound 判断继续或结束。';
  }
  return `【首回复节奏】先处理已有消息，完整的问题及时回答。需要确认对方是否继续补充时，用 qq_wait_for_quiet(quietMs=${quietMs})；从最后来信计时，合批和读提示词的耗时也算，目前还差约 ${Math.ceil(remaining / 1000)} 秒静默。已安静够久可直接回，工具也会立即返回并补上思考期间的新消息。只有明确没说完、你确实要等下文时，才用普通 messages 长等待。`;
}

function buildPreSleepLine() {
  return '【每波回复后的等待｜私聊与群聊共用】完成一波实际回复并逐条提交回执后，调用 qq_wait_for_messages，自选受后台上下限约束的等待时长。收到新消息就继续读取处理，确需确认用户是否还会补充时调用 qq_wait_for_quiet；不同问题或对象分别引用回复，意思相同或接近的内容合并成一波。无人回复且超时，由后台按 p、q 递增概率判定；endRound=true 时后台结束当前轮，不得追发或继续等待；false 时再调用一次等新消息工具。不要自行抽签；不要用静默工具绕过结束计数。旧的固定沉睡前观察已退役。';
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
    return `${roleLine}${identity}${tokenLine}【提醒】你还没有完成回合收尾。先处理本轮已见消息并提交逐条回执；需要等新消息时调用 qq_wait_for_messages，并遵守工具返回的 endRound。普通潜水无需另设固定到期检查；只有明确约定时间的唤醒才使用 qq_set_wake_config 的 sleepMs/sleepUntil。群聊来信概率由全局规则统一决定，不再设置 triggers 或 active 模式。`;
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
        if(on('wake'))ctx.addPromptBlock(buildWakeGuidance(payload.wakeConfig || {}, payload.proactivePolicy || null));
        if (on('muted') && payload.mutedJustClearedNow) {
          ctx.addPromptBlock('【刚解除静音】对方之前说过忙/别吵/等会再聊，现在他主动找你。可以正常回，但简短一点，别提“你刚才说忙”，也别借机多聊；对方没叫你时不要再主动搭话。');
        }
        if (on('reminders')) {
          const line = buildReminderLine(payload.pendingRemindersNow, payload.key);
          if (line) ctx.addPromptBlock(line);
        }
        if (on('reply')) {ctx.addPromptBlock(buildReplyLine(payload));ctx.addPromptBlock('【评分分工】chatWillingness是用户客观上有没有时间与精力聊天，不是你是否喜欢对方；只根据明确忙闲/精力证据，用qq_set_wake_config的chatWillingness和reason更新，无依据保持原值。心情分表示你的主观交流感受并单独决定风格。两者共同影响主动概率、条数和深度；无人回复不自动等于忙，你自己发言也不是用户忙闲证据。');}
        if (on('wake')) ctx.addPromptBlock(buildWakeLine(payload.st, payload.autonomousNow, payload.hasUnreadNow));
        if (on('preSleep')) ctx.addPromptBlock(buildPreSleepLine(payload.preSleepMs));
        return '';
      }
    }
  };
}
