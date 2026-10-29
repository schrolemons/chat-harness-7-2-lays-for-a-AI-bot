export default {saveLabel:"保存资料检索规则",
  "title": "资料目录与按需阅读",
  "fields": [
    {
      "key": "coreSessionKeys",
      "label": "CORE 适用会话（每行一个）",
      "type": "lines",
      "group": "适用范围"
    },
    {
      "key": "maxAutoCards",
      "label": "每轮自动提供的知识卡上限",
      "type": "number",
      "group": "按需读取预算"
    },
    {
      "key": "candidateLimit",
      "label": "检索候选上限",
      "type": "number"
    },
    {
      "key": "maxPromptChars",
      "label": "注入材料预算（字符）",
      "type": "number"
    },
    {
      "key": "worldviewPatterns",
      "label": "世界观议题匹配规则（每行一条）",
      "type": "lines",
      "group": "触发与表达"
    },
    {
      "key": "coreCarePatterns",
      "label": "困扰与关心匹配规则（每行一条）",
      "type": "lines"
    },
    {
      "key": "formalReplyMaxChars",
      "label": "正式回复目标上限（字符）",
      "type": "number"
    }
  ]
};
