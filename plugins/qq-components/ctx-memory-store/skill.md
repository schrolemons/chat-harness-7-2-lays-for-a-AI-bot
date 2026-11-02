# ctx-memory-store

持久记忆与日记读写、捕获、更新和发送；无新消息不按小时反复重写。手动日记与定时日记独立：手动发送任意次数都不抵扣定时发送，到配置的北京时间后刷新并投递一次。

## 日记窗口与发送凭据

- `dailyDiary.hour/minute` 同时决定每日排程和窗口分界，日记以窗口的结束日期命名。`diaryTargetDay` 返回当前尚未结束窗口；过分界后，手动按钮即针对下一结束日期。补发仅处理更早归档。
- 定时凭据 `diary:<key>:<day>:scheduled`；手动每次使用 `:manual:<UUID>`；管理员历史补发使用 `:catchup`。定时只检查自己的凭据，不因旧日期标记、归档或手动记录跳过。
- 进程在当次分界时刻之后才启动时，不补执行当次定时任务。Console 已进入新窗口，同时用红色提示上一窗口未发送；点击补发直接发送已有正文，不请求模型重写。真实凭据处于处理中/结果不明时不盲目重发。
- 定时刷新完成时持久保存本次日记快照；后续手动或小时刷新不替换它。处理中或结果不明的投递不自动重试。重载后依赖中央凭据防重；跨午夜未完成的已请求刷新可继续发送。
- 已有记忆回合时，不借用它作为定时刷新；待该回合结束再请求。限额为 weak/silent 时不调用模型，仍可直接投递该日期已有日记。
- 控制台只把中央 `sent` 回执当发送证明，展示实际发送时分与所属日记日期；旧 `lastDiaryDate` 或文字收据本身不能证实 QQ 收到。当前窗口不再显示“目标日已确认发送”，而是显示上一窗口是否缺发。
- 换窗只切换日记日期，绝不清空聊天的 recentMessages、已读戳、上下文或DSH历史。定时流程先写完整日记、发送并确认中央回执，归档成功后才移出永久记忆的旧日记栏；发送失败/未知时保留正文。若新日记已写入，则旧投递完成不得清掉新正文。同一窗口日记随整理/AI主动写入更新；ctx-memory-update 只参考同一窗口已有日记，允许明确引用昨日聊天作对比，不把旧事冒充新事。C层短聊天窗口不再限制日记选材条数。
- `diaryCurrent` / `updateDiary` 服务通过当前会话的 `qq_diary` 工具读写，沿用 memory 开关，不发送QQ。更新带上 read 返回的 day，换窗则409并要求模型重读，避免迟到写入覆盖新窗口；只修改日记栏目。

同时拥有唯一 `services.affairs`：结构化条目、版本冲突、修改历史、按完整条目选择、独立通知收据与一次性旧记录导入。事务无15000字总存储截断；旧未完成事项不再作为持久记忆栏目返回。自动 capture 合并保留逐条事实，手工 write 明确替换。四类数据职责、迁移与启用步骤见 docs/guides/MEMORY_RESPONSIBILITIES.md。

## 日记按天归档

记忆文件每次重写都会整段覆盖【日记】段，旧日记只能靠归档留档：

- 位置：`state/memory/diary/<YYYY-MM-DD>.md`，日期取本次发送对应的 `day`。
- 格式：文件头 `# <日期> 日记`，每个会话一节 `## <会话 key> · <HH:MM>` + 日记正文（可多行）。
- 幂等：同一日期同一会话保留一节；明确的手动重发和定时刷新以最新正文更新该节，其它会话继续追加。
- 体积上限：单文件超过 `config.diaryArchive.maxChars`（默认 20000）时截断并在末尾注明 `…（已截断）`。
- 每次模型 capture 或 qq_diary 更新都立即回写本日期归档，保留该窗口最新完整正文；未发送的草稿也可从O层历史查看或手动补发。归档与投递是两件事，不能因存在归档就标记已发送；真实发送后才记录中央回执与发送时间。归档失败显式返回 archiveSaved=false 并告警。
- 回填：`onTick` 里当某会话 `lastDiaryDate` 是今天或昨天、而归档缺这一节时，把当前【日记】段补归档；每个会话每天最多一次（记录在插件 state 的 `diaryBackfill` 的 `key|day` 上），失败不影响调度。

## 服务与工具

- `services.memory.diaryArchiveList({limit=30})` → `{ok:true, dates:[{date,count,keys,chars}]}`（date 倒序）。
- `services.memory.diaryArchiveRead({date})` → `{ok:true,date,text}`；没有时 `{ok:false,error:'没有这一天的归档'}`。
- 插件工具 `diary_history`（`{}` 或 `{limit}`）与 `diary_read`（`{date}`）供控制台 `/api/plugins/call` 调用，返回上面两个结果。

控制台「可观测与运维 · 参数」页的「日记历史」分组可日期列表 + 等宽正文查看；插件未启用或没有归档时只显示友好提示。

插拔、配置和验收参见 docs/guides/PLUGIN_RUNTIME_CONTRACT.md。运行 npm run test:plugin-audit，测试使用隔离文件和模拟端点。

日记专项：`node --test scripts/test-diary-truth.mjs scripts/test-budget-diary-direct.mjs scripts/test-notification-delivery.mjs scripts/test-diary-mcp.mjs scripts/test-diary-chat-continuity.mjs`；前端构建后运行 `node scripts/test-diary-truth-ui.mjs` 与 `node scripts/test-diary-config-ui.mjs`。这些是隔离验证，不代表真实 QQ 已投递。
