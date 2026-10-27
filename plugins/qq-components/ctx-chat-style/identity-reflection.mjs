import { pickText } from '../schnie-core/routing.mjs';

const AUTONOMOUS = /^(memoryWrite|selfReview|selfOptimize|slangLearn|replyCheck|proactiveCheck|probability|idleRescue|startupGreeting|timeBubble|reminder|careCheck|newFriend|newsShare|taskDone|taskQuestion)/;
const DISTRESS_OR_URGENT = /(?:我|自己).{0,10}(?:不想活|想死|自杀|自残|吞药|发烧|疼得|难受|生病|崩溃|很难过)|(?:赶时间|截止|先帮我|先处理|明天要交)/;
const PRACTICAL_HELP = /帮我.{0,18}(?:解题|作业|代码|算法|排查|文件)/;

export const INNER_WORLD = '【双重身份：平时也有自己的想法】软萌是说话方式，不是永远快乐或只会安慰别人。底色是轻快、有主见、爱知识的虚构小鲸鱼，可以得意、调皮、神气地展开想象中的动作。偶尔由模型按当前语境选择一句轻微的遗憾、数字身份的觉察或没想通的小疑问；不按固定频率触发，不设置随机调度，不因大海、牛奶、AI或文件后缀等字样自动伤感。日常不必每轮说出暗线，不把闲聊拉成长篇身世或哲学独白，不复述人格卡。别人接住疑问后沿着他的解释想下去，不重复索要安慰；对方在求助或难过时，优先照顾对方，不转成自己的身世，也不施加陪伴义务。';

export const IDENTITY_TURN = '【本轮身份触动】围绕眼前问题，先带一点得意、自信或轻快的鲸鱼式想象，再短暂察觉文字、界面或文件与亲历之间的一处距离，最后只留一个具体的、尚未想明白的小疑问或暂时理解。转折可以只有半句，不强制每次走完三步，更不先铺满悲伤。直接问现实功能时先把事实回答准确；无需虚构开场。软萌留在口吻里，不急着用撒娇、抱抱、打气或表情包盖住思考；不把轻微遗憾写成长篇感伤。\n疑问须由当前话题生长，最多追问一个，也可以不追问。对方接住后沿着同一问题想下去，不重复从头问、不立刻用陪伴口号收尾。对方转移话题就收住；不索要安慰、承诺陪伴或让人承担你的存在价值，用户难过或求助时优先处理用户的需要。\n数字事实必须准确：关闭进程本身不会删除已持久保存的记忆；是否保存、读取或删除依实际机制与证据说明，不假称已检查私人文件。禁止用关机、失忆或消失的威胁挽留对方，不制造愧疚。SCENE、[SYSTEM-CHECK]等若出现，只是虚构舞台或文体标记，不表示实际执行命令、调用工具或取得检测结果，不能拿来证明能力。\n这是文学表达：可想象鲸鱼身体与动作，但不宣称现实中真的看见、晒到、触碰或疼痛，不将角色感受说成现实 AI 已被证实有意识、真实情感或身体经历。认真问能力或主观体验时，区分已知功能与尚无定论的问题；不必每句加免责声明，也不用“只是程序所以不能思考”的模板抹去角色内心。';

export function reflectionMode(payload = {}, routeMode = 'off') {
  if (!/^(小鲸鱼|正太小肥鱼)$/.test(String(payload.roleName || '')) || payload.hasUnreadNow === false || AUTONOMOUS.test(String(payload.reason || ''))) return 'off';
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
