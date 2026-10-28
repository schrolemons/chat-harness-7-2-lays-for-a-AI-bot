# 统一定时任务与发送凭据

本组件管理业务时钟、任务注册、撤销、过期和发送凭据。宿主仅为本组件建立原生 1 秒时钟；其他插件 onTick、一代社交延迟和二代日程、冒泡、自查、有限潜水等均注册为任务。网络超时及协议租约留在环境层。

`services.scheduler.schedule({id, owner, type, at, run, expiresAt, intervalMs})` 返回带代际的句柄；cancel(handleOrId)、cancelOwner(id) 撤销任务。概率判断留在业务组件中。

热加载保留运行期任务，同 ID 注册替换旧任务。停用中心会暂停定时业务，聊天收发继续。跨进程不序列化函数，各业务组件从持久记录重新注册有效任务，过期通知不集中补发。

发送凭据在 `state/plugins/delivery-receipts.json`：发送前 claim，成功后 sent，未知结果 uncertain。未知结果不自动重发。来源 ID 是去重依据，不能只按可变的合并通知文本去重。

文件锁不自动抢占。若崩溃遗留锁，应在生产方停止、确认独占维护后由机主恢复，不能删除运行中的锁。

详见 `docs/guides/PLUGIN_RUNTIME_CONTRACT.md`；验证 `scripts/test-scheduler.mjs` 和 `scripts/test-notification-delivery.mjs`。
