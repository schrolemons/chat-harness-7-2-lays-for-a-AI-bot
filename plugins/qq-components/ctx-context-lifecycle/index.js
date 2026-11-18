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
// 桥接只负责触发事实与副作用（清 pendingReminderItems、清 mutedJustCleared、算 replyTiming），
// 文案全部在组件里。

function buildWakeLine(st, autonomousNow, hasUnreadNow) {
  if (autonomousNow && !hasUnreadNow) return '【这是你主动开口】不是被谁叫醒、也不是在回谁。';
  const wc = st?.wakeConfig || {};
  const time = wc.infinite ? '不另设到时检查' : (wc.sleepUntil && Number.isFinite(Date.parse(wc.sleepUntil)) ? '明确到时唤醒：' + new Date(wc.sleepUntil).toLocaleString() : '未设时间');
  return '【当前唤醒】'+time+'；本轮已开启，不再抽签。私聊来信100%进入处理；必答以入栈tag为准。';
}

function buildReplyLine(payload) {
  const timing = payload.replyTiming || {};
  const quietMs = Number(timing.quietMs) || 8000;
  const lastIncoming=Number(payload.st?.lastIncomingAt);
  const remaining = Number.isFinite(lastIncoming)&&lastIncoming>0
    ? Math.max(0,quietMs-(Date.now()-lastIncoming)) : Math.max(0, Number(timing.remainingQuietMs) || 0);
  if (payload.autonomousNow && !payload.hasUnreadNow) {
    return '【主动开口·不是回复】这一轮是你自己到点/想说话，不是假装对方刚找你。可以自然延续今天或上一段旧话题，按本轮话题选择追问或换题；历史消息按原来的时间理解，不复读旧回答，不把未回答的问题再问一遍。定时冒泡、日程和其他指定任务优先遵守各自内容要求。条数服从统一发送计划；说完并处理回执后，如果有理由认为对方还想聊但暂时没接话，可用 qq_wait_for_messages；否则自然结束。';
  }
  return `【首回复节奏】已有完整意思直接回答。确实还没说完才qq_wait_for_quiet(quietMs=${quietMs})；读消息和思考也计入静默，目前还差约 ${Math.ceil(remaining / 1000)} 秒。收到新来信先处理，不调用qq_wait_for_messages等下一句。`;
}

function buildFollowupWaitLine() {
  return '【无人接话时的等待｜私聊与群聊共用】答复和回执完成后才qq_wait_for_messages；收到新消息立即接住，不先结束旧回合或复述收尾。超时按工具结果：endRound=true结束；否则action=wait继续等，followup接旧话题，newTopic换题。遵守guidance、额度和免打扰，不自行抽签或重问无人回答的问题。明确结束时可直接收尾。';
}

function activeWakeGuidance(w={}){
  return '【唤醒分工】唤醒概率、静默阶段、间隔和限频由程序计算，模型不重算或重设。群聊已醒后与私聊共用接话流程；只在本轮结束后恢复群聊抽签。主动冒泡与收到来信后的回复分别控制，不能因冒泡冷却拒答来信；日程按原排程，不额外安排潜水检查。'
    +(w.recommendedHint?'\n【管理员交流偏好】'+String(w.recommendedHint):'');
}

function buildReminderLine(items, key = '') {
  if (!Array.isArray(items) || !items.length) return '';
  // 隐私硬约束：日程只属于登记它的会话。私聊日程只在私聊说，绝不引导到群里。
  const isGroup = String(key || '').startsWith('group:');
  const where = isGroup ? '在群里提醒（说清时间/地点/内容，别复述系统提示）' : '在当前私聊提醒管理员本人（说清时间/地点/内容）；这是他自己的日程，不要发到群里或转告其他会话';
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
    return `${roleLine}${identity}${tokenLine}【提醒】你还没有完成回合收尾。先处理本轮来信并提交逐条回执。已回复且对方可能还想聊、此刻没接话时，才按需调用 qq_wait_for_messages，并遵守返回的 endRound。普通潜水无需另设固定到期检查；只有明确约定时间的唤醒才使用 qq_set_wake_config 的 sleepMs/sleepUntil。群聊来信概率由全局规则统一决定，不再设置 triggers 或 active 模式。`;
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
        if(payload.budgetStage==='weak')return ''; // Fixed budget batches do not enter normal wake/wait loops.
        if(on('wake'))ctx.addPromptBlock(activeWakeGuidance(payload.wakeConfig || {}));
        if (on('muted') && payload.mutedJustClearedNow) {
          ctx.addPromptBlock('【刚解除静音】对方之前说过忙/别吵/等会再聊，现在他主动找你。可以正常回，但简短一点，别提“你刚才说忙”，也别借机多聊；对方没叫你时不要再主动搭话。');
        }
        if (on('reminders')) {
          const line = buildReminderLine(payload.pendingRemindersNow, payload.key);
          if (line) ctx.addPromptBlock(line);
        }
        if (on('reply')) {ctx.addPromptBlock(buildReplyLine(payload));ctx.addPromptBlock('【评分分工】chatWillingness是用户客观上有没有时间与精力聊天，不是你是否喜欢对方；只根据明确忙闲/精力证据，用qq_set_wake_config的chatWillingness和reason更新，无依据保持原值。心情分表示你的主观交流感受并单独决定风格。两者共同影响主动概率、条数和深度；无人回复不自动等于忙，你自己发言也不是用户忙闲证据。');}
        if (on('wake')) ctx.addPromptBlock(buildWakeLine(payload.st, payload.autonomousNow, payload.hasUnreadNow));
        if (on('preSleep')) ctx.addPromptBlock(buildFollowupWaitLine());
        return '';
      }
    }
  };
}
