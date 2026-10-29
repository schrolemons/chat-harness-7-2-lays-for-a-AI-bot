export default {saveLabel:"保存视频处理参数",
  "title": "视频处理",
  "fields": [
    {
      "key": "ffmpegPath",
      "label": "FFmpeg 程序路径",
      "type": "text",
      "group": "程序与网络"
    },
    {
      "key": "ffmpegUseSystemProxy",
      "label": "FFmpeg 使用系统代理",
      "type": "boolean"
    },
    {
      "key": "maxVideoSeconds",
      "label": "视频总时长上限（秒）",
      "type": "number",
      "group": "任务边界"
    },
    {
      "key": "maxSegmentSeconds",
      "label": "单次片段上限（秒）",
      "type": "number"
    },
    {
      "key": "maxConcurrentJobs",
      "label": "同时处理任务数",
      "type": "number"
    },
    {
      "key": "defaultFrameCount",
      "label": "默认抽帧数量（张）",
      "type": "number",
      "group": "帧图与缓存"
    },
    {
      "key": "maxFrameWidth",
      "label": "帧图最大宽度（像素）",
      "type": "number"
    },
    {
      "key": "cacheDir",
      "label": "缓存子目录",
      "type": "text"
    },
    {
      "key": "cacheTtlMs",
      "label": "缓存有效期（毫秒）",
      "type": "number"
    },
    {
      "key": "requestTimeoutMs",
      "label": "信息请求超时（毫秒）",
      "type": "number",
      "group": "超时"
    },
    {
      "key": "ffmpegTimeoutMs",
      "label": "抽帧任务超时（毫秒）",
      "type": "number"
    }
  ]
};
