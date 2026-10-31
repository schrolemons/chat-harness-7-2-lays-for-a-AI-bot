// Behavior examples owned by this layer; no runtime configuration values.
export default {
  "tool-bilibili": {
    "ffmpegPath": "填写FFmpeg可执行文件路径后，抽帧使用这一程序；留空按现有发现流程寻找。",
    "ffmpegUseSystemProxy": "开启后，FFmpeg相关网络请求允许使用系统代理配置；不修改系统代理本身。",
    "defaultFrameCount": "设为9：未指定帧数时默认抽取9帧供分析，不直接生成9条QQ消息。",
    "maxVideoSeconds": "设为3600：超过1小时的视频不能按整段无界处理。",
    "maxSegmentSeconds": "设为600：一次视频片段最多10分钟。",
    "cacheDir": "填bilibili：抽帧缓存归入本地对应缓存目录，不是远程上传目录。",
    "maxConcurrentJobs": "设为2：最多同时执行2个视频处理任务。",
    "maxFrameWidth": "设为720：抽取图像按不超过720像素宽度处理，减少视觉输入体积。",
    "cacheTtlMs": "设为300000：缓存按5分钟有效期复用，过期后按流程重新获取。",
    "requestTimeoutMs": "设为12000：视频信息网络请求最多等待约12秒。",
    "ffmpegTimeoutMs": "设为180000：一次FFmpeg任务最多等待约3分钟。"
  },
  "tool-injection-lab": {
    "detect": "开启后记录实验发现的注入迹象，不代表对每条消息都额外调用模型。",
    "alertWindowMs": "设为60000：最近一次命中后，后续聊天回合会在1分钟内继续收到上下文警报；到期后停止沿用旧警报，新的命中会重新计时。此参数不控制 QQ 消息发送频率。",
    "sparPerHour": "设为2：对线实验一小时最多触发2次。"
  },
  "tool-registry": {
    "injectPrompt": "关闭后不额外注入组件索引提示，不会删除实际注册的工具。"
  },
  "tool-user-checking": {
    "noteFileName": "填AI助手想说的话.txt：悄悄话、故障待处理和恢复记录都追加到这一个文件。",
    "maxNoteChars": "设为500：单条便签最多约500字；故障摘要过长会缩短，不会拆坏emoji。"
  }
};
