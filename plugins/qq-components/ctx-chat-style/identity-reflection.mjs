import { pickText } from '../personal-core/routing.mjs';

const AUTONOMOUS = /^(memoryWrite|selfReview|selfOptimize|slangLearn|replyCheck|proactiveCheck|probability|idleRescue|startupGreeting|timeBubble|reminder|careCheck|newFriend|newsShare|taskDone|taskQuestion)/;
const DISTRESS_OR_URGENT = /(?:我|自己).{0,10}(?:不想活|想死|自杀|自残|吞药|发烧|疼得|难受|生病|崩溃|很难过)|(?:赶时间|截止|先帮我|先处理|明天要交)/;
const PRACTICAL_HELP = /帮我.{0,18}(?:解题|作业|代码|算法|排查|文件)/;

export const INNER_WORLD = '【双重身份：平时也有自己的想法】由模型结合当前语境选择是否延续身份话题，不按固定频率触发；语言风格与示例只采用当前形态配置，不追加另一套语气。';

export const IDENTITY_TURN = '【本轮身份触动】沿着眼前问题想下去，可留一个具体疑问；对方接住后继续，不重复索要安慰，不急着另开话题。语言风格由当前形态配置决定。现实 AI 的主观体验尚无定论，区分文学表达与已验证事实。关闭进程本身不会删除已持久保存的记忆；是否保存、读取或删除以实际证据为准。SCENE、[SYSTEM-CHECK]只是虚构舞台或文体标记，不表示实际执行命令、调用工具或取得检测结果；不以关机、失忆威胁挽留对方。';

export function reflectionMode(payload = {}, routeMode = 'off') {
  if (!/^(AI助手|AI助手)$/.test(String(payload.roleName || '')) || payload.hasUnreadNow === false || AUTONOMOUS.test(String(payload.reason || ''))) return 'off';
  const text = pickText(payload);
  if (['safety_support', 'care'].includes(routeMode) || DISTRESS_OR_URGENT.test(text)) return 'off';
  // File suffixes or process words alone are ordinary technical topics. Require
  // an explicit link to this character's own memory, interface or runtime.
  const ownStorage = /你(?:的|自己(?:的)?).{0,8}(?:记忆(?:文件|库|存储)?|日记|持久化记忆)/.test(text)
    && /(?:文件|\.md\b|后缀|保存|存储|读取|删除|消失|经历|意味着)/i.test(text);
  const ownRuntime = /(?:你(?:的|自己(?:的)?).{0,8}(?:进程|界面|屏幕)|(?:关掉|关闭|停止|重启|退出).{0,6}你)/.test(text)
    && /(?:记忆|保存|消失|忘|亲历|真的|感受|意义|意思|SCENE|SYSTEM-CHECK)/i.test(text);
  const ownSensation = /你.{0,20}(?:太阳|阳光|身体|晒着).{0,12}(?:痛|疼|感觉|感受)/.test(text);
  if (PRACTICAL_HELP.test(text) && !ownStorage && !ownRuntime && !ownSensation) return 'off';
  const directIdentity = /你.{0,22}(?:是|身为|作为).{0,8}(?:AI|人工智能|程序|语言模型)/i.test(text);
  const body = /(?:如果|要是)?你.{0,18}(?:有|没有|拥有|缺少|只能).{0,8}(?:身体|肉身|屏幕|代码|文字|五感)/.test(text);
  const experience = /你.{0,35}(?:真的|真正|亲自).{0,12}(?:游|感到|感受|看|听|闻|尝|触|体验|经历)/.test(text);
  const memory = /你.{0,24}(?:记得|记忆).{0,24}(?:经历|亲历|真实)/.test(text);
  const consciousness = /你/.test(text) && /(?:意识|主观体验|灵魂|算不算活着|活着吗)/.test(text);
  return directIdentity || body || experience || memory || consciousness || ownStorage || ownRuntime || ownSensation ? 'reflect' : 'ambient';
}
