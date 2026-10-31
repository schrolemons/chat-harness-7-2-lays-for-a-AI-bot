// Topic choice after admission, never a second wake/end-round lottery.
const textOf = m => String(m?.plain ?? m?.text ?? m?.tail ?? '').trim();
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function hasReplyContent({st = {}, selfName = '', selfId = '', roleName = '', groupNames = ''} = {}) {
  const names = [selfName, selfId, roleName, ...String(groupNames).split(/[,，\n]/)].map(x => String(x).trim()).filter(Boolean);
  return (st.unread || []).some(m => {
    if (!m || m.isSelf) return false;
    let text = textOf(m);
    if (/^\[拍一拍\]/.test(text)) return false;
    if (m.hasMedia === true || (Array.isArray(m.media) && m.media.length > 0)
      || m.quoted?.text || /\[引用/.test(String(m.text || ''))) return true;
    text = text.replace(/\[CQ:at,qq=(\d+)(?:,[^\]]*)?\]/g, (raw, id) => id === String(selfId) ? '' : raw).trim();
    for (const name of names) text = text.replace(new RegExp('^@?' + escapeRegex(name) + '[\\s!?？！，。~～]*$'), '').trim();
    // QQ may render a group card with an extra prefix (e.g. @DeepSeekAI助手).
    // Require structured self-target evidence and a known name suffix; never
    // discard an arbitrary @token or words following the name.
    if(m.atSelf===true&&(text==='@'||names.some(name=>new RegExp('^@[^@\\s]*'+escapeRegex(name)+'[\\s!?？！，。~～]*$').test(text))))return false;
    // Unknown mentions, images, quoted text and substantive words stay pending.
    return !!text;
  });
}
export function hasBareSelfAttention(payload={}){
  if(payload.hasUnreadNow===false)return false;
  return (payload.st?.unread||[]).some(message=>message&&!message.isSelf&&!/^\[拍一拍\]/.test(textOf(message))
    &&(textOf(message)||message.atSelf===true)&&!hasReplyContent({...payload,st:{unread:[message]}}));
}
export const BARE_ATTENTION_GUIDANCE='【本次空@招呼】当前有只叫你参与、没有具体正文的招呼；不把它当成待补全的问题，不按次数责问或催促补字，也不凭空归因于网络故障。先处理同批及此前真正未回答的内容；没有具体待答内容时，按本轮话题建议延续最近未结话题或开启合适新话题，可以直接用话题接住招呼。不要把此前“只@不说话”的回复继续当作话题；缺少切入点或受冷却、免打扰、额度限制时正常等待。';
export function hasCurrentTopic(st = {}, now = Date.now(), identity = {}) {
  if ((st.activeTopics || []).some(t => t?.text && !['done', 'closed', 'cancelled'].includes(t.status))) return true;
  return [...(st.unread || []), ...(st.recentMessages || [])].some(m => {
    if (!hasReplyContent({...identity, st:{unread:[m]}})) return false;
    let at = Number(m.at ?? m.time ?? m.timestamp);
    if (at > 0 && at < 1e11) at *= 1000;
    // The previous exchange can cross midnight. Its timestamp stays in the
    // actual QQ snapshot; the model decides relevance without pretending it is new.
    return Number.isFinite(at) && at > 0 && at <= now;
  });
}

export function openingGuidance(choice) {
  const {action, followupProbability: a, newTopicProbability: b} = choice;
  const summary = `【主动开聊｜话题抽签】仅用于本轮第一次主动开口；只留一个容易接的问题，用户未答不再补第二个问题。已经发过开场不重复执行，收到新来信先回应新消息。本轮主动机会已经通过；只选内容，不再判定是否唤醒或终止。可用分支：延续 ${(a * 100).toFixed(1)}%，换题 ${(b * 100).toFixed(1)}%。`;
  if (action === 'none') return summary + '当前话题分支均被关闭或处于冷却，不强行发消息，不绕过限额；仍按公共等待工具处理本轮。';
  const selected = action === 'followup'
    ? '已选延续：优先沿着今天的话题或上一条/段消息，挑一个尚未聊完的具体细节自然追问。用 conversationIntent="followup"。'
    : '已选换题：先确认没有最新待答问题，再从当前QQ已确认近况、兴趣或自己的当下想法切入一个具体的新话题；留一个容易回应的问题。用 conversationIntent="newTopic"，并给出稳定 topicId。';
  return summary + selected + '先读最近相关消息和当前话题，判断是否已经收束；已经收束、无可追问细节时可改开新话题，但仍须满足新话题冷却和小时上限。不要重复未回答的问题、复读旧回答、凭空编造经历；历史消息不是刚刚发来的，不假装对方刚找你。保持当前心情形态的人设风格。对方明确忙碌、拒绝、免打扰、缺少合适内容或发送受限时不勉强；这不是抽到终止分支。发送成功后按公共等待机制继续。';
}
