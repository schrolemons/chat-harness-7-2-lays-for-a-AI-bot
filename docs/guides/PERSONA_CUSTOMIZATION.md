# Chat Bridge 人设深度定制指南

这份指南以 Chat Bridge 公开版 v0.5.1 的源码为起点，供开发者交给自己的 AI 使用。先按新角色设定填写 Console，再审查参与提示注入、群聊触发和 DSH 命名的源码。下面对私人版的说明只描述实现差异，定制时请使用你自己的角色资料和合成示例。

## 先写好角色简报

- **身份**：角色名、别名、自称、身份设定、能做与不能做的事。角色名使用 Console 实际选中的名称，代码中的匹配条件也以这个值为准。
- **关系和语气**：普通用户、群友和机主分别怎么称呼。分别给普通形态和临界形态写几组示范，覆盖短消息、被夸、图片、认真求助和需要安慰的情况。
- **触发和主动行为**：群里哪些词算点名，收到拍一拍怎么接话，启动时是否主动问候，什么时间或场合保持安静。
- **系统文案和界面名称**：等待中、超额时、余额预警各怎么说。列出一代、二代和管理员预设的显示名，以及私聊、群聊、任务、学习和网页整理的标题格式。

## Console 可配置的内容

| 内容 | 配置与源码入口 | 写法 |
| --- | --- | --- |
| 角色卡 | C 层角色编辑器 → [`persona-actions.js`](../../console/layers/C/persona-actions.js)；角色文件在 [`roles/`](../../roles/)，激活状态由 `state/current-role.json` 保存 | 在 Console 创建并选中新卡。卡片定义身份、关系和行为边界。二代读取时会经 [`ctx-role-card`](../../plugins/qq-components/ctx-role-card/index.js) 清洗，保存后还要检查实际注入文本。 |
| 心情与语言形态 | [`ctx-user-mood` 表单](../../console/layers/C/components/ctx-user-mood.js)的 `normalStyle`、`criticalStyle` 和形态参数 | 每个形态分别写自称、用词、停顿、亲近程度及示范。严肃任务仍用当前形态说话，事实、引用和工具结果按实表达。 |
| 思考时的机械回执 | [`life-message-ack` 表单](../../console/layers/L/components/life-message-ack.js)的 `privateWait`、`groupWait`、`privateApology`、`groupApology`；一代即时回执另查 [`src/bridge.js`](../../src/bridge.js) 的 `ackMessage` | 按私聊、群聊和阶段分别写可直接发送的短句。用模拟测试确认已发正式回复时，挂起的机械回执会取消。 |
| 超额时的机械回复 | [`ctx-knowledge-quota` 表单](../../console/layers/C/components/ctx-knowledge-quota.js)的 `deflectText` | 写一条最多 120 字的成品文案。它会直接发出，并结束该条请求的模型调度。 |
| 余额预警说明 | [`deepseek-balance.js`](../../console/layers/O/deepseek-balance.js)的 `alertStyle` | 写角色如何理解预算变化、如何称呼管理员和解释告警。余额数字、告警条件和投递权限仍由运行逻辑提供。 |

## 公开版和私人版的源码差异

| 位置 | 两版怎样不同 | 定制时改哪里 |
| --- | --- | --- |
| 聊天风格和补充示范 | 私人版额外注入带角色意象的短接话示范。公开版保留同一注入机制，使用通用助手示范。 | [`expression-policy.mjs`](../../plugins/qq-components/ctx-context-dynamics/expression-policy.mjs) 的 `SHORT_CHAT_EXAMPLES` 是代码内补充示范，`currentDialogueExamples()` 按约定的行首抽取当前形态示范。[组件入口](../../plugins/qq-components/ctx-context-dynamics/index.js)的 `softNormalForm()` 决定何时补充，`buildMoodExpression()` 与 `beforePrompt()` 分别参与系统风格和当前轮注入。需要保留这种强化时，两处应使用同一套新角色示范，优先服从 Console 当前形态。 |
| 拍一拍 | 私人版用角色化的互动措辞，公开版以友好招呼或确认在场为默认。 | [`poke-interaction.mjs`](../../plugins/qq-components/ctx-chat-style/poke-interaction.mjs) 的 `POKE_INTERACTION_RULE` 定义怎么接话，[聊天风格组件](../../plugins/qq-components/ctx-chat-style/index.js)在 `hasPokeForSelf()` 成立时注入。改措辞时保留真实发起人和目标判断、已处理事件去重、回复与回拍共用发送计划。 |
| 称呼和关系 | 私人版有机主专称、普通用户昵称和被索要专称时的接话方式。公开版以管理员及通用称呼为默认。 | [`whale-addressing.mjs`](../../plugins/qq-components/ctx-context-dynamics/whale-addressing.mjs) 保留了历史文件名。一起检查 `resolveWhaleAddressing()` 的角色名匹配和身份解析、`WHALE_ADDRESS_RULE`、`renderWhaleAddressing()`、`nicknameRequestActive()` 及 `validateWhaleAddressing()`。提示里的称呼和发送前校验应一致，机主身份仍通过可信的 `ownerQQ` 确认，同名或前缀相同的用户分别处理。 |
| 主动问候 | 私人版将启动问候写成角色刚醒的场景，公开版按时间做简短问候。 | [`life-proactive-startup-greeting`](../../plugins/qq-components/life-proactive-startup-greeting/index.js)的 `beforePrompt()` 拥有场景措辞，`hint` 可提供简短角度。还要看 [`life-wake-reasons`](../../plugins/qq-components/life-wake-reasons/index.js)的 `startupGreeting` 分支，保持两处叙事一致。启动延时、免打扰、场景授权及按真实投递回执记冷却继续走原流程。 |
| 群聊叫名与关键词 | 两版内置的角色别名不同。角色卡改名后，旧词仍可能命中。 | 在 [`src/bridge.js`](../../src/bridge.js) 查 `social.mustReplyKeywords` 默认值与调用点，再核对 [`config.example.json`](../../config.example.json)及实例实际保存的值。二代群聊另查 [`group-wake.mjs`](../../plugins/qq-components/life-wake-reasons/group-wake.mjs) 的 `groupNames`。用新别名、旧别名、同名群友及真实 @ 分别验证。 |
| 身份反思 | 两版的 `reflectionMode()` 都按各自角色名决定是否启用。 | [`identity-reflection.mjs`](../../plugins/qq-components/ctx-chat-style/identity-reflection.mjs) 的 `reflectionMode()`、`INNER_WORLD`、`IDENTITY_TURN` 要一起审查。新角色有这条叙事线时，匹配真实角色名并写新提示。没有这条叙事线时，让新角色保持关闭。保留后台回合、求助和安全支持的排除条件。 |
| DSH 预设和会话命名 | 两版的一代、二代和管理员预设显示名，以及部分用途型会话的兜底标题不同。QQ 私聊、群聊的新建标题另有自己的入口。 | 按下一节分别改预设显示名、工作区名、显式会话标题和兜底标题。 |

角色名、旧自称、旧专称或意象也可能出现在角色专用提示、默认配置和测试中。搜索结果按用途逐项审查，示范和 UI 文案可按设定替换，工具名、组件 ID、唤醒事件名、会话键和历史数据按各自契约处理。

**改了形态名时，要一起验证补充示范是否仍触发。** `softNormalForm()` 会匹配形态名或风格说明里的用词。 `currentDialogueExamples()` 则依赖示范行的前缀，例如普通形态的「私聊：」「被夸：」「关心：」。定制时可沿用这些前缀，也可以同时调整提取规则和测试。

## DSH 预设名、工作区名和会话标题

| 想改的名称 | 实际拥有源 | 应用方式 |
| --- | --- | --- |
| **预设显示名**，如「星轨向导 · 二代仿真」 | [`dsh/agent-presets/`](../../dsh/agent-presets/)下各目录的 `preset.yml`，字段是 `name` | 按需要修改 `qq-chat`、`qq-chat-v2`、`qq-admin` 等预设的 `name`，需要时同步 `description`。角色换名时保持目录名和注册 ID 稳定。工具声明在同目录 `agent.cordis.yml`。 |
| **预设注册 ID**，如 `qq-chat-v2` 和实例作用域 ID | [`instance-session-policy.mjs`](../../src/instance-session-policy.mjs)的 `OWNED_PRESET_SOURCES`、`presetIdMap`、`resolvePreset()` | 当前实例靠这些 ID 区分工具面并关联会话。更换显示名无需改 ID。确需换 ID 时单独设计迁移，验证旧会话的映射、权限和实例隔离。 |
| **工作区名**，如「星轨向导 · 聊天」 | 受管实例由 [`instance-session-policy.mjs`](../../src/instance-session-policy.mjs)的 `workspaceTitle()` 使用实例描述符 `label` 和用途生成。旧模式按 [`src/bridge.js`](../../src/bridge.js)对应路径读取标题配置或默认值 | 区分聊天、学习、任务、网页整理。新工作区与已有工作区分别核对，修改 `label` 后无需重建已有工作区。 |
| **新 QQ 聊天会话的显式标题**，如「星轨向导 · 私聊 · 会话 A」 | [`src/bridge.js`](../../src/bridge.js)的 `ensureSession()` 在新建时设置 `params.title`。任务新会话在同文件查 `任务 · `。 | 这里显式传入的标题优先，通常不会经过预设兜底命名。区分私聊、群聊和不同会话。需要展示或截图时，使用自选标签或短编号代替 QQ 号和聊天内容。 |
| **按用途生成的兜底会话标题** | [`src/session-titles.js`](../../src/session-titles.js)的 `LABELS`、`sessionTitle()`，以及 [`session-title-fallback.mjs`](../../plugins/qq-agent-presets/session-title-fallback.mjs) | 修改各预设对应的兜底标签。实例作用域 ID 会映射回源预设 ID。保留标题清洗、长度限制、用户或模型提供的有效标题，以及已有会话的采用路径。 |

受管实例读取的是生成后的预设定义。改完源 `preset.yml` 后执行下面两条命令，然后在 DSH 的目标实例中查看实际预设列表。生成文件位于 `plugins/qq-agent-presets/presets/`，源码更改和运行时加载需要分别确认。

```powershell
node scripts/build-agent-preset-patches.mjs
node scripts/build-agent-preset-patches.mjs --check
```

如果还要给已有会话改显示标题，先列出目标会话、当前标题和新标题，由开发者确认后使用 DSH 的会话重命名能力。保留会话 ID、原记录、预设绑定和用户手动命名。用新会话试验即可核对新规则。

## 可以直接交给开发者 AI 的任务

```text
按照我的角色简报定制当前 Chat Bridge 实例。先列出目标实例、实际激活的角色卡、
Console 已保存的覆盖项、角色名匹配、预设 ID 与会话标题的真实拥有源。

先改可配置的人设、心情形态、机械回执、超额短句和余额预警。
再处理源码里的短句示范、称呼、拍一拍、启动问候、群聊别名和身份反思。
为指定的 DSH 预设、工作区、私聊、群聊和其他用途设置显示名称。
保留内部 ID、现有会话绑定、收发权限和角色当前设置之外的其他实例。

使用合成 QQ 事件和独立 DSH 测试实例验证。给我一张修改清单，标明
每项的源文件、配置优先级、实际显示或注入证据，以及哪些变更需要重新加载。
```

## 验收

1. **看实际注入。** 在 Console 的 **O 层 → 可视化 context** 分别检查普通形态、临界形态和严肃任务。确认示范按预期进入对应区段，当前形态的自称与称呼一致。
2. **模拟不同关系和触发。** 分别测试机主、普通用户、同名群友、索要专称、拍 bot、拍别人、启动问候和超额场景。检查发送回执、冷却、免打扰和权限隔离。
3. **在 DSH 检查显示名与绑定。** 查看实际预设列表和新会话，分别验证显式标题、兜底标题及工作区名。读取已有会话，核对原 ID、标题、历史和预设绑定。
4. **按改动运行回归。** 下面命令覆盖提示注入、群聊触发及标题行为。改了心情、机械回执或预算文案时，补跑对应组件测试。需要真实收发时，仅用开发者指定的测试会话。

```powershell
node --test scripts/test-chat-expression-priority.mjs scripts/test-whale-addressing.mjs scripts/test-chat-style.mjs scripts/test-group-wake-bridge.mjs
node --test scripts/test-session-titles.mjs scripts/test-session-title-recovery.mjs scripts/test-agent-preset-patches.mjs
```
