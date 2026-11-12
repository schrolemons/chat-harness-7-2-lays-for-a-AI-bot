// Behavior examples owned by this layer; no runtime configuration values.
export default {
  "obs-session-recovery":{
    "consecutiveFailures":"设为3：同群3个独立回合出现相同请求错误，且中间没有正常模型输出，才可能触发恢复。",
    "minFailureSeconds":"设为120：3次失败若都发生在10秒内，仍不会重建会话。",
    "cooldownMinutes":"设为30：本次恢复成功后，半小时内不会再次自动重建该群会话。",
    "maxRecoveriesPerDay":"设为2：过去24小时内已恢复两次，就只保留诊断，不继续重建。"
  },
  "obs-health-monitor": {
    "staleAlertCooldownMs": "设为1800000：同一轮心跳异常告警至少间隔30分钟，不会每次巡检都刷屏。"
  }
};
