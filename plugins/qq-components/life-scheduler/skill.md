# 统一定时任务与发送凭据

本组件管理业务时钟、任务注册、撤销、过期和发送凭据。宿主仅为本组件建立原生 1 秒时钟；其他插件 onTick、一代社交延迟和二代日程、冒泡、自查、有限潜水等均注册为任务。网络超时及协议租约留在环境层。

`services.scheduler.schedule({id, owner, type, at, run, expiresAt, intervalMs})` 返回带代际的句柄；cancel(handleOrId)、cancelOwner(id) 撤销任务。概率判断留在业务组件中。

热加载保留运行期任务，同 ID 注册替换旧任务。停用中心会暂停定时业务，聊天收发继续。跨进程不序列化函数，各业务组件从持久记录重新注册有效任务，过期通知不集中补发。

发送凭据在 `state/plugins/delivery-receipts.json`：发送前 claim，成功后 sent，未知结果 uncertain。未知结果不自动重发。来源 ID 是去重依据，不能只按可变的合并通知文本去重。

文件锁不自动抢占。若崩溃遗留锁，应在生产方停止、确认独占维护后由机主恢复，不能删除运行中的锁。

## 主动行为、定时冒泡与日程提醒

`scheduler.wakePolicy({incomingReason,activeReason})` 保存优先关系：proactiveCheck/careCheck/newsShare/idleRescue 可替代排队中的本会话时间冒泡，也可请求中止正在运行的 timeBubble；日程 reminder 回合不被这些普通主动行为抢占。reminder 也可优先于时间冒泡。这里只判断关系，DSH 传输操作仍由 bridge 提供。

取消调度句柄只取消尚未执行的任务，不能当作已经中止模型。桥接用 turn/start 将真实 turn 与投递原因关联，通过 `session/cancel` 只取消当前冒泡，不清 DSH inbox；旧回合结束且取消请求明确返回后，才重放后继唤醒。排队日程优先，日程条目和明确完成状态由 life-schedule-reminder 持有，不因冒泡取消而删除。

抢占先持久认领 `wake-preempt:<sessionId>:<turn>` 凭据，结果不明记 uncertain，不自动重发取消、也不放行后继模型回合，防止迟到的取消请求误伤新提醒。此状态是待核实阻塞，不代表已成功抢占；提醒载荷保留，管理员核查后可明确打断或重置会话恢复。禁止删除生产锁试错。

已抢占的回合轮换令牌；旧出站在执行前复查所属回合，迟到文字/end 由回合身份和持久凭据抑制。已经进入网关的发送不能撤回。日程载荷只由 reminder 回合读取，成功工具发送/自动回复后才消费对应批次；派发失败保留，后续周期可重试，提醒发送不等于用户已完成。

隔离行为验证：`node --test scripts/test-proactive-priority.mjs`。采用临时状态、桩 QQ/DSH，不发送真实消息。

详见 `docs/guides/PLUGIN_RUNTIME_CONTRACT.md`；验证 `scripts/test-scheduler.mjs` 和 `scripts/test-notification-delivery.mjs`。
