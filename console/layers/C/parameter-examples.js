// Behavior examples owned by this layer; no runtime configuration values.
export default {
  "ctx-chat-topic-drive": {
    "privateFollowupEnabled": "开启后，群聊里值得继续的话题可以转到已有私聊关系中跟进；不会自动给陌生人发私聊。",
    "minIntervalMinutes": "设为60：两次私聊跟进至少间隔1小时；会话局部间隔更长时按更长的执行。",
    "dailyLimit": "设为2：同一人一天最多收到2次这类私聊跟进；局部上限更低时按更低的执行。",
    "sessionLimits": "给某个会话设更长间隔或更低上限，只收紧该会话，不放宽全局限制。",
    "followUpCooldownMinutes": "设为30：刚跟进过同一话题时，接下来30分钟阻止对同一话题追加可选追问。",
    "newTopicCooldownMinutes": "设为60：刚开新话题后，1小时内优先延续现有话题，而非不断另起话头。",
    "newTopicMaxPerHour": "设为2：一小时内最多成功发起2个新话题；普通聊天和主动聊天共用额度。"
  },
  "ctx-interest-terms": {
    "autoExtract": "开启后，达到消息门槛时自动提取兴趣候选；候选仍需审核确认后入库。",
    "autoResearch": "开启后，重复出现的候选可触发研究；关闭不会删除已确认的知识。",
    "minMessages": "设为12：同群累计到12条可用消息才尝试一批提取，不会每条消息都调用模型。",
    "cooldownMs": "设为1800000：同群两次自动提取至少隔30分钟。",
    "maxCallsPerHour": "设为4：自动候选提取每小时最多调用4次。",
    "injectMax": "设为3：一轮最多把3条相关的已确认词条提供给模型，不代表必须输出3条。"
  },
  "ctx-knowledge-quota": {
    "enabled": "开启后，在模型派发前检查专业问答额度；普通闲聊不应因此扣额。",
    "dailyLimit": "设为3：当天前三个符合识别规则的专业请求可进入模型，超出后用固定短句带过。",
    "resetHour": "设为22：每日22点开始新的专业问答计数周期。",
    "exemptOwner": "开启后管理员不受本组件的专业问答次数限制；总花费上限仍独立生效。",
    "countBy": "选user按人计数；选session按会话范围计数，不等于全站共用一个次数。",
    "deflectText": "填“今天先到这里，明天再聊这个吧”：超额时直接发这句，不再调用模型生成拒答。",
    "keywords": "添加“量子力学”：将其作为领域识别线索，还需符合专业请求规则，不能只凭闲聊提到词语就扣额。"
  },
  "ctx-media-sticker-pick": {
    "limit": "设为8：每轮最多给模型8个表情候选，由模型按当前语境选择，不是连续发8张。"
  },
  "ctx-member-alias": {
    "autoExtract": "开启后，从聊天中收集绰号候选；不会把猜测直接当作已确认姓名。",
    "autoSemantic": "开启后，允许语义分析疑似绰号；关闭后不自动调用这条分析路径。",
    "minMessages": "设为12：累计12条群消息后才尝试分析，减少零散消息重复调用。",
    "cooldownMs": "设为1800000：同群自动分析至少间隔30分钟。",
    "maxCallsPerHour": "设为4：每小时最多触发4次自动绰号分析。"
  },
  "ctx-memory-context": {
    "maxChars": "设为4000：本轮轻量记忆按4000字符预算组织；不是删除原始记忆。",
    "affairsMaxChars": "设为2000：本轮事务上下文最多占约2000字符，事务档案本身不会因此被截断。"
  },
  "ctx-memory-profile-facts": {
    "cooldownMs": "设为60000：同一会话的自动事实提取至少间隔1分钟。",
    "maxSnippets": "设为8：最多保留8条提取片段进入该组件的处理范围。",
    "maxCharsPerSnippet": "设为300：单条事实片段最多保留300字符，防止长文本挤占上下文。"
  },
  "ctx-memory-store": {
    "diaryArchive": "开启后保留日记归档；日记归档不等于每轮都注入聊天提示词。"
  },
  "ctx-memory-update": {
    "maxChars": "设为6000：给记忆维护回合组织材料时使用6000字符预算，不代表清空更长的持久记录。"
  }
};
