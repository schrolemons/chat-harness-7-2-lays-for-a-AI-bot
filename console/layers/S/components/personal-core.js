export default {
  "title": "目录挂载与按需阅读",
  "saveLabel": "保存挂载与阅读设置",
  "fields": [
    {
      "key": "libraryDir",
      "label": "资料包根目录（本机路径）",
      "type": "text",
      "maxLength": 4096,
      "group": "目录挂载"
    },
    {
      "key": "referenceSessionKeys",
      "label": "目录提示适用会话（留空为全部）",
      "type": "lines",
      "group": "会话适用范围"
    },
    {
      "key": "careSessionKeys",
      "label": "优先关怀会话（可选）",
      "type": "lines"
    },
    {
      "key": "catalogPageSize",
      "label": "目录每批默认条数",
      "type": "number",
      "group": "按需阅读预算"
    },
    {
      "key": "maxReadChars",
      "label": "短卡整读／单页正文上限（字符）",
      "type": "number"
    }
  ]
};
