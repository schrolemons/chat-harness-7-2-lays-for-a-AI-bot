// Behavior examples owned by this layer; no runtime configuration values.
export default {
  "schnie-core": {
    "coreSessionKeys": "填private:10001：将该会话登记为CORE相关范围，不自动向其他群共享私人材料。",
    "maxPromptChars": "设为7500：SCHNIE给当前回合组织的提示材料不超过该字符预算。",
    "maxAutoCards": "设为2：自动选择时最多提供2张相关知识卡，不要求把全部原稿读进上下文。",
    "candidateLimit": "设为6：检索候选先限定为6项，再按实际相关性选择。",
    "worldviewPatterns": "添加“什么是自由”：匹配世界观议题时可进入对应资料处理方式。",
    "coreCarePatterns": "添加“撑不住”：在CORE困扰语境中优先采用关心方式，不据此诊断疾病。",
    "formalReplyMaxChars": "设为450：正式表达按450字符预算约束，不改变原始资料文件。"
  }
};
