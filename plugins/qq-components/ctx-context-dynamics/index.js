// ctx-context-dynamics（C 层｜心情与表情策略）
//
// 从 buildWakePromptV2 搬走两段「每轮动态生成」的提示词：
//   · 心情引导：心情值 → 语气/条数建议；被叫回来/恢复期的附注
//   · 表情策略：收藏表情候选、最近发过哪些，以及正文表情的统一使用规则
//
// 桥接只传事实：心情值/阈值/是否刚被叫回来/是否恢复期、sticker 配置、收藏表情列表。
// 表情候选排序仍由 ctx-media-sticker-pick 组件负责（这里只给策略与列表）。

import { buildStickerContext, findSticker } from '../../../src/sticker-lib.js';
import {splitPromptUnicode} from '../../../src/prompt-unicode.js';
const expressionURL=new URL('./expression-policy.mjs',import.meta.url);expressionURL.search=new URL(import.meta.url).search;
const {buildStickerStrategyHint,recentExpressionHint,expressionTail,repeatedExpressionTails,currentDialogueExamples,validateReceiptMarker,validateRecentRepetition}=await import(expressionURL.href);
const addressingURL=new URL('./whale-addressing.mjs',import.meta.url);addressingURL.search=new URL(import.meta.url).search;
const {resolveWhaleAddressing,renderWhaleAddressing,nicknameRequestActive,validateWhaleAddressing,WHALE_ADDRESS_RULE}=await import(addressingURL.href);
const softNormalForm=state=>state?.mode!=='critical'&&/普通|友好|自然/.test(String(state?.modeName||'')+'\n'+String(state?.styleInstruction||''));

function buildMoodExpression(moodState,hasAddressing=false) {
  if(!moodState||moodState.enabled===false||!Number.isFinite(moodState.score))return '';
  return ['【交流目标】延续当前角色与管理员选定的形态，日常先接住眼前一句，不默认转成分析、检索或任务；工具和记忆按需要使用。正事保持准确，认真时仍沿用当前语气。下面完整配置是表达依据，旧助手口癖不作示范，不照抄示例事件或经历。',
    '【当前形态】'+moodState.modeName+'。'+moodState.styleInstruction,
    hasAddressing?WHALE_ADDRESS_RULE:''].filter(Boolean).join('\n');
}

function buildMoodBlock(moodState) {
  if(!moodState||moodState.enabled===false||!Number.isFinite(moodState.score))return '';
  const rules=[...(moodState.policy?.positiveRules||[]),...(moodState.policy?.negativeRules||[])];
  const history=(moodState.history||[]).slice(0,5);
  return {rules:rules.length?'【行为规则】'+rules.map(r=>r.id+': '+r.label+'（'+r.delta+'）'+r.description).join('；')+'。仅在实际语境支持时使用 qq_mood，不按关键词自动变分。':'',current:history.length?'【最近真实变化】'+history.map(h=>h.source+' '+h.before+'→'+h.after+' '+h.reason).join('；'):''};
}

function buildStickerBlock(payload) {
  const cfg = payload.stickerConfig || {};
  if (cfg.enabled === false) return '';
  const entries = Array.isArray(payload.stickerEntries) ? payload.stickerEntries : [];
  const st = payload.st || {};
  const cooldownMin = Math.max(0, Number(cfg.recentCooldownMinutes) || 30);
  const cooldownMs = cooldownMin * 60000;
  const now = Date.now();
  const recentNames = (Array.isArray(st.recentStickers) ? st.recentStickers : [])
    .filter((x) => x && x.id && now - Number(x.at || 0) < cooldownMs)
    .map((x) => {
      const e = findSticker(entries, x.id);
      return (e?.desc || e?.localNote || String(x.id)).slice(0, 20);
    });
  // 机主 10/27 反馈「发图策略也尽量别总发一张图哦」：冷却列表只能说明「最近发过」，
  // 拦不住「同一张连着用」。这里单独统计近两小时的重复次数，用得多的直接点名换掉。
  const repeatWindowMs = Math.max(cooldownMs, 120 * 60000);
  const useCounts = new Map();
  for (const x of (Array.isArray(st.recentStickers) ? st.recentStickers : [])) {
    if (!x || !x.id) continue;
    if (now - Number(x.at || 0) > repeatWindowMs) continue;
    useCounts.set(x.id, (useCounts.get(x.id) || 0) + 1);
  }
  const overused = [...useCounts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([id]) => {
      const e = findSticker(entries, id);
      return (e?.desc || e?.localNote || String(id)).slice(0, 20);
    });
  let turnLine = '';
  if (recentNames.length) {
    turnLine = '【最近发过的表情（这次换一张）】' + [...new Set(recentNames)].join('、') + '。这一轮换一张没发过的；同一张 ' + cooldownMin + ' 分钟内别再用，也别连着两条都用同一张。';
  }
  if (overused.length) {
    turnLine += (turnLine ? '\n' : '') + '【这几张最近用太多了，先收起来】' + [...new Set(overused)].join('、') + '。这两小时内别再发它们，换别的图或只用文字。';
  }
  if (cfg.includeInPrompt === false) return turnLine;
  const strategy = buildStickerStrategyHint();
  const context = buildStickerContext(entries, cfg.promptMaxStickers ?? 8);
  return [strategy, turnLine, context].filter(Boolean).join('\n');
}

import { createTurnPolicy } from '../personal-core/turn-policy.mjs';

export function createPlugin(ctx) {
  const referencePolicy = createTurnPolicy(ctx);
  const cfg = ctx.config || {};
  const disabled = new Set(Array.isArray(cfg.disabledBlocks) ? cfg.disabledBlocks.map(String) : []);
  const expressions=new Map(),recentOwn=new Map(),addressingByKey=new Map(),privateWindows=new Map();
  const latestSeq=st=>Math.max(0,...[...(st?.recentMessages||[]),...(st?.unread||[])].filter(m=>m&&!m.isSelf&&Number.isSafeInteger(m.seq)).map(m=>m.seq));
  const inputStamp=payload=>{
    try{
      const history=ctx.capabilities?.readLocalConversationHistory?.({key:payload.key,limit:20,forLookup:true});
      const id=String(payload.key||'').split(':')[1];
      const event=history?.ok&&history.messages?.findLast(e=>e.message_type==='private'&&String(e.user_id)===id&&(!payload.selfId||e.self_id==null||String(e.self_id)===String(payload.selfId)));
      const messageId=event?.message_id??event?.msg_id??event?.message_seq;
      return messageId==null?null:String(messageId);
    }catch{return null;}
  };
  return {
    services:{chatExpression:{current({key}={}){const value=expressions.get(key);return value?{...value}:null;},validate({key,text,kind}={}){
      if(kind==='text'&&/示例禁词|私聊用户|群聊用户/.test(String(text||'')))return {ok:false,reason:'disallowed_chat_wording',hint:'本条尚未发送。删去被禁止的叠词或渠道标签称呼，按对方已约定的称呼或真实昵称自然接话；不要向对方解释检查过程。'};
      const window=privateWindows.get(key);
      const stamp=kind==='text'&&window?inputStamp(window):null;
      if(kind==='text'&&window&&(latestSeq(window.st)>window.throughSeq||stamp!==null&&window.inputStamp!==null&&stamp!==window.inputStamp))return {ok:false,reason:'new_private_input',hint:'生成回复期间有新的私聊来信到达，本条尚未发送。先读取当前未读消息并结合最新回答重写，已经回答的问题不要再问；不要重发旧草稿。'};
      const protocol=validateReceiptMarker({text,kind});if(!protocol.ok)return protocol;
      const repeat=validateRecentRepetition({text,kind,messages:recentOwn.get(key)});if(!repeat.ok)return repeat;
      const addressed=validateWhaleAddressing(addressingByKey.get(key),{text,kind});if(!addressed.ok)return addressed;
      const tail=kind==='text'?expressionTail(text):'';
      return tail&&repeatedExpressionTails(recentOwn.get(key)).some(([used])=>used===tail)?{ok:false,reason:'repeated_expression_tail',hint:'这个句尾已在近期重复使用。按当前完整示范重新接话，直接自然收句；不要换一个颜文字补位，不要解释规则。'}:{ok:true};
    }}},
    hooks: {
      beforePrompt(payload = {}) {
        if(String(payload.key||'').startsWith('private:')&&payload.st){privateWindows.set(payload.key,{key:payload.key,selfId:payload.selfId,st:payload.st,throughSeq:latestSeq(payload.st),inputStamp:inputStamp(payload)});if(privateWindows.size>256)privateWindows.delete(privateWindows.keys().next().value);}
        expressions.delete(payload.key);
        addressingByKey.delete(payload.key);
        const own=payload.recentOwnMessages||payload.st?.recentMessages||[];
        recentOwn.set(payload.key,own.filter(m=>m?.isSelf).slice(-6));if(recentOwn.size>256)recentOwn.delete(recentOwn.keys().next().value);
        if (/^(memoryWrite|selfReview|selfOptimize|userFeedbackReview|slangLearn)$/.test(String(payload?.reason||''))) return '';
        if (!disabled.has('mood')) {
          const addressing=resolveWhaleAddressing(payload,ctx.capabilities?.getOwnerQQ?.(),ctx.capabilities?.readLocalConversationHistory);
          if(addressing){addressing.requestActive=nicknameRequestActive(payload);addressingByKey.set(payload.key,addressing);if(addressingByKey.size>256)addressingByKey.delete(addressingByKey.keys().next().value);}
          const expression=buildMoodExpression(payload.moodState,!!addressing);
          if(expression){
            ctx.addPromptBlock(expression);
            if(/^(private|group):\d+$/.test(String(payload.key||''))){expressions.set(payload.key,{kind:'selected-admin-style',text:splitPromptUnicode(expression).join('\n\n')});if(expressions.size>256)expressions.delete(expressions.keys().next().value);}
          }
          if(payload.moodState?.enabled!==false&&Number.isFinite(payload.moodState?.score))ctx.addPromptBlock('【心情数值】'+payload.moodState.score+'/100；当前选定'+payload.moodState.modeName+'形态。分数不是受冷落或失落的事实，语气按当前完整形态；沉默和历史余额查询不自动构成新的情绪依据。');
          if(payload.moodState?.enabled!==false&&payload.moodState?.styleInstruction){
            ctx.addPromptBlock('【本轮表达校准】使用系统中管理员选定的'+(payload.moodState.mode==='critical'?'临界':'普通')+'形态，先接住当前具体内容；历史助手回复不作示范，未分析的图片不编画面，分享状态不自动当成结束聊天。');
            const examples=currentDialogueExamples(payload.moodState.styleInstruction,payload.moodState.mode);if(examples)ctx.addPromptBlock(examples);
          }
          if(addressing&&expression)ctx.addPromptBlock(renderWhaleAddressing(addressing,{soft:softNormalForm(payload.moodState)}));
          if(referencePolicy(payload).mode !== 'off')return '';
          const mood = buildMoodBlock(payload.moodState);
          if (mood?.rules) ctx.addPromptBlock(mood.rules,{placement:'stable'});
          if (mood?.current) ctx.addPromptBlock(mood.current);
        }
        const repetition=recentExpressionHint(own);if(repetition)ctx.addPromptBlock(repetition);
        if (referencePolicy(payload).mode === 'off' && !disabled.has('sticker')) {
          const sticker = buildStickerBlock(payload);
          if (sticker) ctx.addPromptBlock(sticker);
        }
        return '';
      }
    }
  };
}
