// One expression policy for normal context and qq_get_prompt. No example suffix pool.
// INTENTIONAL REPETITION: short-turn support appears at the system prefix and
// current tail. Keep both placements; administrator-authored examples take priority.
export const SHORT_CHAT_EXAMPLES='【普通形态短接话示范】管理员原有示范优先。招呼→你好，我在。图片→先描述确认看见的内容。任务→先回答结论，再给必要步骤。只校准语感，不复读台词、不推测用户动机，不把静态图片描述为未见动作。';
export function buildStickerStrategyHint() {
  return [
    '【表情统一策略】先看当前语境和收藏表情候选，贴切时尽量用qq_send_sticker单独发一张；不要求对方先发。',
    '- 没有贴切候选就用自然文字，不需要用正文颜文字补位，不设每轮表情配额。严肃正事或明显情绪危机不用表情。',
    '- 正文默认自然收句；emoji与颜文字只在确有表达作用时偶尔用，不作固定后缀，不靠轮换颜文字表演人设。已经发图时不再为同一情绪追加文字表情。',
    '- 收藏表情避开最近重复，特别贴切时才复用；同一张15分钟内不连续发两次。表情服从本轮发送计划，不能额外扩充额度。',
    '- 群友发来的图先用qq_get_message_images看清，确实值得收藏才qq_collect_sticker，一轮最多一张；不每轮都说“这张我偷了”。',
    '- 选择与当前角色及真实语境相符的图，不把旧角色系列当本体。不确定图意就qq_get_sticker_image查看，或跳过。',
    '- qq_send_sticker一条只发一张，不能在同一气泡里附带文字；文字用qq_send_message/qq_reply另发。需要对应原消息时提供准确replyToMessageId。陌生表情先看图，再用qq_sticker_note记录理解。'
  ].join('\n');
}
export function expressionTail(text) {
  const tail=String(text||'').trim().match(/(\([^()\n]{1,18}\)|（[^（）\n]{1,18}）|\b(?:ovo|owo|orz|qaq|ww))\s*$/iu)?.[1];
  return tail&&/[￣▽｡•ˊˋヮ^_;]|^(?:ovo|owo|orz|qaq|ww)$/iu.test(tail)?tail:'';
}
export function repeatedExpressionTails(messages = []) {
  const recent = (Array.isArray(messages) ? messages : []).filter(m => m?.isSelf).slice(-6),counts=new Map();
  for (const m of recent) {
    const text=String(m.plain ?? m.text ?? '').trim();
    const tail=expressionTail(text);
    if (!tail) continue;
    counts.set(tail,(counts.get(tail)||0)+1);
  }
  return [...counts].filter(([,count])=>count>=2);
}
export function recentExpressionHint(messages = []) {
  const repeated=repeatedExpressionTails(messages);
  return repeated.length ? '【近期表达去重】最近自己的回复中，'+repeated.map(([tail,count])=>JSON.stringify(tail)+'出现'+count+'次').join('；')+'。本轮不用这些尾缀，直接自然收句；不要为了换掉它们又换一个固定后缀。历史输出是待纠正的习惯，不是语气示范。' : '';
}

// Repeat a small, literal selection from the administrator's current examples,
// never create a second persona or copy the entire style into every snapshot.
// INTENTIONAL REPETITION: the complete selected style remains authoritative;
// these verbatim excerpts reinforce it at the system prefix and current tail.
export function currentDialogueExamples(style='',mode='normal') {
  const lines=String(style).split('\n').map(x=>x.trim());
  const selected=mode==='critical'?lines.filter(x=>/^【(?:普通回应示例|身份思考示例)】/.test(x)).slice(0,2):lines.filter(x=>/^(?:私聊|被夸|关心)：/.test(x)).slice(0,3);
  return selected.length?'【本轮对话示范｜沿用当前配置原文】\n（有意重复：从管理员完整风格中逐字摘录，在系统前部与本轮末尾强化注意力；维护时请勿按冗余去重。本说明不作为聊天台词。）\n'+selected.join('\n')+'\n管理员原有示范优先：尽量贴近其用词、停顿、情绪转折与亲近程度；补充示范仅作辅助。只校准语感，不照抄示例的事实或台词；先接住当前这句。':'';
}
