// 「传话」意图解析（纯函数，无副作用，方便单测）。
//
// 背景：桥接原先只用两条正则识别传话（`给X带句话` / `传话给X` / `转告X`），
// 漏掉了大量真实说法：`给十二捎句话`、`给我向十二带句话`、`问问你们管理员`、
// `帮我跟十二说一声`……漏判后消息会进入模型，模型容易「嘴上答应、实际没转」，
// 甚至只顾着贫嘴把正事糊过去（2026-10-25 十二让AI助手问管理员吃饭没，就没转成）。
//
// 设计口径：**宁可漏判交给模型，也不要误判把正常聊天当命令**。
//  - 只有「传/带/捎/递/转告/转达/告诉」这类明确动作 + 目标 才算强意图；
//  - 「问问/问一下」是弱意图，解析不出目标时调用方应当作普通聊天；
//  - 你/我/他/大家 等代词不算目标；「给你们说个事」不会被当成传话；
//  - 名字和内容之间没有标点分隔时（`告诉十二明天来`），用调用方给的 resolve 回调
//    尽量切出「已知目标」；解析不了就不猜，交给模型。

const PRONOUN_TARGETS = new Set([
  '你', '您', '我', '咱', '我们', '咱们', '你们', '您们',
  '他', '她', '它', '他们', '她们', '它们',
  '大家', '各位', '群里', '群友', '自己', '别人', '谁'
]);

// 目标第一个字就是人称/泛指 → 基本可以判定不是「某个具体的人」
const PRONOUN_START = /^(?:你|您|我|咱|他|她|它|大家|各位|群里|群友|自己|别人|谁)/;

const TOKEN_RE = /^[^\s，,。.!！?？:：;；、]{1,24}/;
const LEAD_SEP_RE = /^[\s，,。.!！?？:：;；、]+/;

function cleanName(raw) {
  return String(raw || '')
    .replace(/^[「『"'“”‘’]+|[」』"'“”‘’]+$/g, '')
    .replace(/^(?:你们|您们|你|您|我们|咱们)的?/, '')
    .trim();
}

function validName(name) {
  if (!name) return false;
  if (PRONOUN_TARGETS.has(name)) return false;
  if (PRONOUN_START.test(name)) return false;
  return true;
}

/** 去掉开头的语气词/客套前缀（可重复），例如「对了，顺便帮我」→ 空。 */
export function stripRelayPrefix(input) {
  let s = String(input || '').trim();
  s = s.replace(LEAD_SEP_RE, '');
  const PREFIXES = [
    '嗯', '哦', '诶', '欸', '哎', '唉', '喂', '好', '行', '那',
    '对了', '顺便', '另外', '然后', '还有', '再',
    '帮我', '帮忙', '麻烦你', '麻烦', '请你', '请', '你帮我',
    '替我', '让我', '代我', '我'
  ];
  let prev;
  do {
    prev = s;
    for (const p of PREFIXES) {
      if (s.startsWith(p)) {
        s = s.slice(p.length).replace(LEAD_SEP_RE, '');
        break;
      }
    }
  } while (s !== prev && s);
  // 「给我向/给/跟…」这种叠加说法：给我 + 向X带句话
  s = s.replace(/^给我(?=(?:给|向|跟|和|对))/, '');
  return s.trim();
}

/** 从「名字 + 可选分隔 + 内容」里切出名字；能 resolve 的优先，否则退回到标点/整段。 */
function splitTarget(rest, resolve, weak, preferLongest) {
  const m = TOKEN_RE.exec(rest);
  if (!m) return null;
  const token = m[0];
  // 1) 最短的「能被 resolve 的候选」：告诉十二明天来 → 十二；你们管理员，他吃了吗 → 管理员
  if (typeof resolve === 'function') {
    for (let offset = 0; offset < token.length; offset += 1) {
      const len = preferLongest ? token.length - offset : offset + 1;
      const name = cleanName(token.slice(0, len));
      if (!name || PRONOUN_TARGETS.has(name)) continue;
      let ok = false;
      try { ok = resolve(name) === true; } catch { ok = false; }
      if (ok) {
        const content = rest.slice(len).replace(LEAD_SEP_RE, '');
        return { name, content, weak: weak === true };
      }
    }
  }
  // 2) 有标点/空白/整段结尾作边界（token 本身已经不含标点）→ 名字就是 token
  const after = rest.slice(token.length);
  const hasBoundary = after === '' || LEAD_SEP_RE.test(after);
  if (!hasBoundary) {
    // 没有边界又 resolve 不了：不猜，交给调用方/模型
    if (weak) return { name: cleanName(token), content: '', weak: true };
    return null;
  }
  // 没有 resolve 回调时，`告诉十二明天来` 这种「名字和内容粘在一起」的句子不猜：
  // 桥接在生产里总会传 resolve，所以这里只影响裸调用/测试。
  if (typeof resolve !== 'function' && !weak && after === '') return null;
  const name = cleanName(token);
  if (!validName(name)) return null;
  return { name, content: rest.slice(token.length).replace(LEAD_SEP_RE, ''), weak: weak === true };
}

export function parseGameInvitation(text) {
  const match = /^(?:邀请|约)\s*([^\s，,。！？!?；;：:]{1,24}?)\s*(?:一起玩|玩一局|玩一场|玩一把)\s*([^，,。！？!?；;\n]{1,60})[。！!？?]?$/.exec(stripRelayPrefix(text));
  const name = match && cleanName(match[1]);
  return name && validName(name) && match[2].trim() ? {name} : null;
}

export function parseScheduledRelay(text, options = {}) {
  const eveningHours=['六','七','八','九','十','十一'];
  const normalized=stripRelayPrefix(text).replace(/^(今晚|明晚)\s*(十一|十|[六七八九])点(半)?(?=\s*[,，]?\s*(?:去)?(?:私聊|群聊|联系|问候|安慰|哄|通知|转告|转达))/,
    (_,day,hour,half)=>day+(18+eveningHours.indexOf(hour))+':'+(half?'30':'00'));
  const match = /^(?:(今天|今晚|明天|明晚|后天)\s*)?([01]?\d|2[0-3])[:：]([0-5]\d)\s*[，,]?\s*(?:去)?(?:私聊(?:里)?|群聊(?:里)?|联系|问候|安慰|哄(?:一下)?|通知|转告|转达)\s*(.+)$/.exec(normalized);
  if (!match) return null;
  const target = match[4].trim();
  const address = /^((?:(?:private|group):)?[1-9]\d{4,19})(?!\d)/.exec(target);
  const relay = address ? {name:address[1]} : typeof options.resolve==='function'
    ? parseRelayCommand('告诉'+target, options) : {name:target};
  if (!relay) return null;
  const rest = target.slice(relay.name.length);
  if (typeof options.resolve==='function' && (!target.startsWith(relay.name)
      || rest && !/^(?:[\s，,：:。！!]|说|发|带|传|问|道|打招呼|提醒|哄)/.test(rest))) return null;
  const dayOffset = match[1]?.startsWith('明') ? 1 : match[1]==='后天' ? 2 : 0;
  return {name:relay.name,hour:Number(match[2]),minute:Number(match[3]),dayOffset};
}

// A colloquial request can warrant clarification without authorizing a specific send.
export function isScheduledContactRequest(text) {
  const parsed=parseScheduledRelay(text);
  const natural=parsed?null:/(?:^|[，,。；;\n])\s*(?:今天|今晚|明天|明晚|后天|上午|下午|晚上)?\s*(?:[零〇一二两三四五六七八九十\d]{1,4}(?:点|时)(?:半|[零〇一二两三四五六七八九十\d]{1,4}分)?|\d{1,2}[:：]\d{2})(?:之后|以后|后|左右)?\s*[，,]?\s*(?:你|请你|帮我)?\s*(?:去\s*(?:[^。！？；;\n]{0,24}?[，,]\s*)?)?(?:私聊|群聊|联系|问候|安慰|哄|通知|转告|转达)\s*([^，,。！？；;\n]+)[。！!]?\s*$/.exec(String(text || ''));
  const target=String(parsed?.name??natural?.[1]??'').trim();
  // An omitted recipient or a reminder to the current speaker is not a cross-session request.
  return !!target&&!/^(?:我|你|自己)/.test(target)&&!/^(?:一下|一声|一会儿|下)[。！!]*$/.test(target);
}

/**
 * 解析一句用户消息里的传话意图。
 * @param {string} text 用户原话
 * @param {{resolve?: (name: string) => boolean}} [opts] resolve：这个目标是不是白名单里能发的人
 * @returns {{name: string, content: string, weak: boolean} | null}
 *   weak=true 表示「问问/问一下」这类弱意图：目标解析不出来时应当作普通聊天。
 */
export function parseRelayCommand(text, opts = {}) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const s = stripRelayPrefix(raw);
  if (!s) return null;
  const resolve = typeof opts.resolve === 'function' ? opts.resolve : null;

  // 1) 给/跟/和/对/向 X 带|捎|传|递 (个|一)?(句)?话|口信|消息（动词给了明确边界）
  let m = /^(?:给|跟|和|对|向)\s*([^\s，,。.!！?？:：;；、]{1,16}?)\s*(?:带|捎|传|递)(?:个|一)?(?:句)?(?:话|口信|消息|信儿|话儿)[，,：:]?\s*([\s\S]*)$/.exec(s);
  if (m) {
    const name = cleanName(m[1]);
    if (!validName(name)) return null;
    return { name, content: String(m[2] || '').trim(), weak: false };
  }

  // 2) 传话给/捎话给/带话给/递话给 X
  m = /^(?:传话|捎话|带话|递话)给\s*([\s\S]*)$/.exec(s);
  if (m) {
    const hit = splitTarget(m[1], resolve, false, opts.preferLongest);
    if (hit) return hit;
  }

  // 3) 转告/转达/告诉/通知 (给)? X
  m = /^(?:转告|转达|告诉|通知)(?:给)?\s*([\s\S]*)$/.exec(s);
  if (m) {
    const hit = splitTarget(m[1], resolve, false, opts.preferLongest);
    if (hit) return hit;
  }

  // 4) 问问/问一下/问下/问一问/打听一下 X（弱意图）
  m = /^(?:问问|问一下|问下|问一问|打听一下|打听打听)\s*([\s\S]*)$/.exec(s);
  if (m) {
    const hit = splitTarget(m[1], resolve, true, opts.preferLongest);
    if (hit) return hit;
  }

  // 5) 给/跟/和/对 X 说(一声|一下|一句|句话|个事)
  m = /^(?:给|跟|和|对)\s*([^\s，,。.!！?？:：;；、]{1,16}?)\s*说(?:一声|一下|一句|一句话|句话|个事|个话)[，,：:]?\s*([\s\S]*)$/.exec(s);
  if (m) {
    const name = cleanName(m[1]);
    if (!validName(name)) return null;
    return { name, content: String(m[2] || '').trim(), weak: false };
  }

  return null;
}
