// Behavior examples owned by this layer; no runtime configuration values.
export default {
  "obs-cost-policy": {
    "defaultModel": "选deepseek-flash：普通任务默认使用Flash，不影响供应商密钥。",
    "defaultEffort": "选low：普通任务以low思考档位请求；不是改变回复速度的固定秒数。",
    "upgradeModel": "选deepseek-v4-pro：满足升级条件时才使用该模型。",
    "upgradeEffort": "选high：升级任务以high档位请求，不改普通任务的默认档位。",
    "autoUpgradeComplexTasks": "关闭后不凭复杂度自动升级；明确指定升级的请求仍按允许范围处理。"
  },
  "obs-health-monitor": {
    "staleAlertCooldownMs": "设为1800000：同一轮心跳异常告警至少间隔30分钟，不会每次巡检都刷屏。"
  }
};
