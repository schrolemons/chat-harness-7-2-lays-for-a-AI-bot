// The system carries one complete administrator-selected style. The current
// tail can retain a small literal excerpt; no second generated voice is added.
export function validateRecentRepetition({text,kind,messages=[],now=Date.now()}={}){
 const normalize=s=>String(s||'').replace(/\s+/gu,'').trim(),body=normalize(text);
 if(kind!=='text'||[...body].length<16)return {ok:true};
 const prior=messages.find(m=>m?.isSelf&&Number.isFinite(m.time??m.at)&&now-(m.time??m.at)>=0&&now-(m.time??m.at)<15*60000&&normalize(m.plain??m.text)===body);
 return prior?{ok:false,reason:'repeated_chat_body',hint:'相同正文已在本会话最近15分钟内真实发出。不要重发、改标点重试或复述内部流程；处理尚未回应的新内容，没有新内容就结束本次发言。'}:{ok:true};
}
export function validateReceiptMarker({text,kind}={}) {
  return kind==='text'&&/^\s*【QQ#\d+(?:\.\d+)?】/mu.test(String(text||''))
    ? {ok:false,reason:'internal_receipt_marker',hint:'QQ正文混入了内部收据编号。删除行首的【QQ#编号】后重新发送自然正文；编号只供内部定位，不向群友解释内部规则。'}
    : {ok:true};
}
export const SHORT_CHAT_EXAMPLES="【普通形态短接话示范】（补充示范；管理员当前配置优先。）简短招呼可回应“你好，我在。”；分享图片时先描述图中真实可见的内容，不猜测未展示的动作或动机；明确的任务先给结论，再补必要步骤、依据和限制。按语境决定是否追问，不机械复读示例。";
export function buildStickerStrategyHint() {
  return [
    '【表情统一策略】先看当前语境和收藏表情候选，贴切时尽量用qq_send_sticker单独发一张；不要求对方先发。',
    '- 没有贴切候选就用自然文字，不需要用正文颜文字补位，不设每轮表情配额。严肃正事或明显情绪危机不用表情。',
    '- 正文默认自然收句；emoji与颜文字只在确有表达作用时偶尔用，不作固定后缀，不靠轮换颜文字表演人设。已经发图时不再为同一情绪追加文字表情。',
    '- 收藏表情避开最近重复，特别贴切时才复用；同一张15分钟内不连续发两次。表情服从本轮发送计划，不能额外扩充额度。',
    '- 入站图片先显示为“一张图片，尚未分析”，原图只作临时缓存；这不表示已看懂画面。普通附图仍由你选择是否看图，可直接理解的文字聊天不自动解析每张图。但要直接引用图片消息回复，必须先用qq_get_message_images按该图片的准确消息ID成功读取并理解，再结合观察回复；用户引用旧图片提问且回答依赖画面时，也先解析被引用的原图。已有同图成功观察可以复用，不重复读取。纯文字招呼直接接话，不为无关旧图或角色示范查图。缓存失效或读取失败如实说明，不猜画面、不换工具绕过。动图按工具给出的帧序解释，抽帧失败只有首帧时不编完整动作。确实值得收藏才qq_collect_sticker，一轮最多一张；不每轮都说“这张我偷了”。',
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
// These few verbatim lines are a short attention cue, not another full copy.
export function currentDialogueExamples(style='',mode='normal') {
  const lines=String(style).split('\n').map(x=>x.trim());
  const selected=mode==='critical'?lines.filter(x=>/^【(?:普通回应示例|身份思考示例)】/.test(x)).slice(0,2):lines.filter(x=>/^(?:私聊|被夸|关心)：/.test(x)).slice(0,3);
  return selected.length?'【本轮对话示范｜沿用当前配置原文】\n'+selected.join('\n')+'\n管理员原有示范优先；只学语气，不照抄事实或台词。':'';
}
