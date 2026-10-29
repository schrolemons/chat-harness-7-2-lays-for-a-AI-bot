// 时间冒泡插件：桥接到点会用它设置的 pendingTimeBubble 唤醒，
// 插件把那一条「冒泡要求」写进提示词，桥接只负责收尾。

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  const clean = (value, max = 100) => String(value || '').replace(/[\r\n]/g, ' ').trim().slice(0, max);
  const personalContext = (key, supplied) => {
    const data = supplied || ctx.capabilities?.getTimeBubbleContext?.(String(key || '')) || {};
    return { displayName: clean(data.displayName, 20), confirmedRoutine: clean(data.confirmedRoutine, 100),
      context: clean(data.context, 200), mood: data.mood || {} };
  };
  const directText = (key, label, count, supplied) => {
    const data = personalContext(key, supplied), name = data.displayName ? `${data.displayName}，` : '', when = clean(label, 20) || '这个时间点';
    const detail = data.confirmedRoutine ? `你安排的${data.confirmedRoutine}` : `${when}这会儿的安排`;
    const variants = [ `${name}${when}到了，${detail}还顺利吗？`, `${name}到${when}啦，${detail}今天想照常来，还是换个轻松点的节奏？`, `${name}${when}来打个招呼，${detail}进行得怎么样？` ];
    return variants[count % variants.length];
  };
  const activeSession = (key) => {
    const current = ctx.runtime?.bubbleSession;
    return current?.key === String(key || '') && Date.now() - Number(current.at) < 20 * 60000;
  };
  ctx.registerTool('time_bubble_manage', {
    description: '查看或调整某个 session 的定时主动冒泡时段。仅当用户在本人私聊中明确分享/修改作息或饮食时间，且适合规划时使用。先 get 读取现有计划与锁定状态，再根据档案卡的作息和饮食习惯由你决定是否 set；保留无关时段，只改未锁定项。若结果包含锁定冲突，简短提醒用户该时段保持锁定。不得推断或跨会话使用他人作息。',
    schema: { type: 'object', required: ['action', 'key'], properties: {
      action: { type: 'string', enum: ['get', 'set'] },
      key: { type: 'string', description: '本人私聊 private:QQ号；或需要独立安排的群聊 group:群号' },
      slots: { type: 'array', maxItems: 20, description: '完整目标时段列表；set 时只改未锁定时段，保留其他未改时段', items: { type: 'object', required: ['hour', 'minute', 'label'], properties: {
        id: { type: 'string' }, hour: { type: 'integer', minimum: 0, maximum: 23 }, minute: { type: 'integer', minimum: 0, maximum: 59 },
        label: { type: 'string', maxLength: 20 }, hint: { type: 'string', maxLength: 120 }, enabled: { type: 'boolean' }
      } } }
    } },
    handler: ({ action, key, slots } = {}) => {
      if (!activeSession(key)) return { ok: false, error: 'not_current_session' };
      if (action === 'get') return ctx.capabilities.getTimeBubbles?.({ key }) || { ok: false, error: 'schedule_service_unavailable' };
      if (action === 'set') {
        if (!Array.isArray(slots)) return { ok: false, error: 'slots_required' };
        return ctx.capabilities.updateTimeBubbles?.({ key, slots }) || { ok: false, error: 'schedule_service_unavailable' };
      }
      return { ok: false, error: 'invalid_action' };
    }
  });
  const quota=(key)=>{
    const d=new Date(),today=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
    const state=ctx.state.get(),entry=state.byKey?.[String(key)]||{};
    const configured = Number(cfg.maxBubblesPerDay);
    return {state,today,count:entry.day===today ? Number(entry.count)||0 : 0,max:Number.isFinite(configured) ? Math.max(0, Math.round(configured)) : 3};
  };
  return {
    services: { timeBubble: { releaseDirect({ key } = {}) {
      const { state, today, count } = quota(key);
      ctx.state.set({ byKey: { ...(state.byKey || {}), [String(key)]: { day: today, count: Math.max(0, count - 1) } } });
    }, prepareDirect({ key, label, context } = {}) {
      const { state, today, count, max } = quota(key);
      if (count >= max) return '';
      ctx.state.set({ byKey: { ...(state.byKey || {}), [String(key)]: { day: today, count: count + 1 } } });
      return directText(key, label, count, context);
    } } },
    canWake(p={}) {const q=quota(p.key);return q.count<q.max;},
    hooks: {
      beforePrompt(payload) {
        if (payload?.reason !== 'timeBubble') {
          if (payload?.key && ctx.runtime) ctx.runtime.bubbleSession = { key: String(payload.key), at: Date.now() };
          if (payload?.isPrivate && payload?.hasUnreadNow && cfg.enabled !== false) {
            return '【自主冒泡排程】用户已经允许你结合其本人私聊档案中的作息与饮食时间规划冒泡。只有在用户明确分享或修改了这些时间时，才可调用 time_bubble_manage 先读取再调整当前 session 的时段；先看锁定状态，保留被锁项目，最多安排到每日次数上限。若工具返回锁定冲突，只需简短提醒时段仍被锁定。不要在群聊透露档案内容，也不要替别人改作息。';
          }
          return '';
        }
        const st = payload?.st;
        if (!st) return '';
        const tb = st.pendingTimeBubble && typeof st.pendingTimeBubble === 'object' ? st.pendingTimeBubble : {};
        st.pendingTimeBubble = null;
        const label = String(tb.label || '这个时间点').slice(0, 20);
        const hint = String(tb.hint || '').slice(0, 60);
        const where = String(payload?.key || '').startsWith('group:') ? '群里' : '私聊里';
        const personal = personalContext(payload.key, payload.timeBubbleContext);
        // 每天最多几条（插件自己的状态里记）
        const {state,today,count,max}=quota(payload.key);
        if(count>=max)return '';
        const byKey={...(state.byKey||{}),[String(payload.key)]:{day:today,count:count+1}};
        if(Object.keys(byKey).length>200)delete byKey[Object.keys(byKey)[0]];
        ctx.state.set({byKey});
        return [
          `【本轮时间冒泡｜${label}】现在到了${label}。${hint ? `创作要求（不得照抄）：${hint}。` : ''}`,
          `当前QQ本人资料：${personal.displayName || '未提供称呼'}；已确认作息：${personal.confirmedRoutine || '未提供，不猜测'}；近期上下文：${personal.context || '使用本轮已有真实上下文，不伪造刚发生的事'}。`,
          personal.mood.styleInstruction ? `当前形态「${clean(personal.mood.modeName, 30)}」：${clean(personal.mood.styleInstruction, 200)}` : '',
          `你在主动开口：直接在${where}围绕本人资料、当前时段和一个具体切入点组织自然短句，给一个容易接的话口。不要暴露别人的私聊档案，不随意联网搜索，不照抄hint或套固定饮食例句。`,
          '换个自然说法，不假称用户刚刚说过旧内容；实际条数和风格服从本轮统一发送计划。日程提醒优先，不抢占目的事件。'
        ].join('\n');
      }
    }
  };
}
