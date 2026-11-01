export default {
  "title": "目录挂载与按需阅读",
  "saveLabel": "保存并校验资料包挂载",
  "fields": [
    {
      "key": "libraryDir",
      "label": "资料包根目录（本机路径）",
      "type": "text",
      "maxLength": 4096,
      "group": "目录挂载",
      "help": "例：D:\\qq-bridge\\private-libraries\\my-core。填写含 manifest.json 的根目录；留空卸载。"
    },
    {
      "key": "referenceSessionKeys",
      "label": "自动导读适用会话（留空为全部）",
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
      "label": "目录默认分页条数",
      "type": "number",
      "group": "按需阅读预算"
    },
    {
      "key": "maxReadChars",
      "label": "单次正文读取上限（字符）",
      "type": "number"
    }
  ]
};
