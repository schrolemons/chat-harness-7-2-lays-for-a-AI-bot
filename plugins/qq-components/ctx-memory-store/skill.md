# ctx-memory-store

持久记忆与日记读写、捕获、更新和发送；无新消息不按小时反复重写，同会话当日日记只发一次，人工与定时共用凭据，不追发旧日记。

## 日记按天归档

记忆文件每次重写都会整段覆盖【日记】段，旧日记只能靠归档留档：

- 位置：`state/memory/diary/<YYYY-MM-DD>.md`，日期取本次发送对应的 `day`。
- 格式：文件头 `# <日期> 日记`，每个会话一节 `## <会话 key> · <HH:MM>` + 日记正文（可多行）。
- 幂等：同一日期同一会话只写一节（文件里已有 `## <key> ·` 就跳过），其它会话继续追加，不覆盖已有内容。
- 体积上限：单文件超过 `config.diaryArchive.maxChars`（默认 20000）时截断并在末尾注明 `…（已截断）`。
- 归档失败只 `warn`，绝不影响日记发送；发送成功（`sent === true`）之后才写归档。
- 回填：`onTick` 里当某会话 `lastDiaryDate` 是今天或昨天、而归档缺这一节时，把当前【日记】段补归档；每个会话每天最多一次（记录在插件 state 的 `diaryBackfill` 的 `key|day` 上），失败不影响调度。

## 服务与工具

- `services.memory.diaryArchiveList({limit=30})` → `{ok:true, dates:[{date,count,keys,chars}]}`（date 倒序）。
- `services.memory.diaryArchiveRead({date})` → `{ok:true,date,text}`；没有时 `{ok:false,error:'没有这一天的归档'}`。
- 插件工具 `diary_history`（`{}` 或 `{limit}`）与 `diary_read`（`{date}`）供控制台 `/api/plugins/call` 调用，返回上面两个结果。

控制台「可观测与运维 · 参数」页的「日记历史」分组可日期列表 + 等宽正文查看；插件未启用或没有归档时只显示友好提示。

插拔、配置和验收参见 docs/guides/PLUGIN_RUNTIME_CONTRACT.md。运行 npm run test:plugin-audit，测试使用隔离文件和模拟端点。
