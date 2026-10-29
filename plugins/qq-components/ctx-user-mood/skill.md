# 心情管理

本组件唯一拥有按 `group:群号` / `private:QQ` 保存的会话总心情，范围0–100，默认60。不会自然回升或回落，不读隐式夸骂词表。配置包括 `enabled`、`initial`、`noReplyAfterMinutes`（默认20）、双形态阈值/名称/风格、行为规则与AI自主调整上限。每日首次恢复下限60与未答扣10为固定规则，以policy的dailyFloor/noReplyPenalty只读返回，不接受配置覆盖。关闭时不建立新等待、不结算，调度频率因子为1，保留已有账本。

服务 `mood.initialize({conversations:[{key,score}],now})` 只导入尚未拥有的有效旧分值，0同样有效；已有分值绝不覆盖。`mood.policy()` 返回唯一有效配置。`mood.read({key,now})` 返回 `enabled,score,mode,modeName,styleInstruction,band,unansweredStreak,frequencyFactor,replyCeiling,detailLevel,welcomeBurstActive,welcomeBurstUntil,cooldownUntil`，不因查询时间改变分值或持久状态。

`mood.adjust({key,action,value,reason,ruleId?,now})` 只允许add/dec与有限正数value≤100，返回ok/before/score/reason。指定ruleId时必须在当前规则中存在，action方向与规则delta一致，value不大于abs(delta)；未指定时value不大于maxAdjustment（默认20，范围1–100）。有效调整先结清已经到期的等待，再做显式加减，避免tick稍晚时在0分边界改变应有结果。外层工具必须绑定当前QQ会话，本组件不注册模型工具。

positiveRules/negativeRules均为{id,label,delta,description}数组，分别接受正/负且绝对值≤100的delta；非法项和重复ID不成为有效规则，可配置空数组。默认正向：友好招呼+3、认真回应/分享+5、称赞关心+5；负向：明确嫌烦-5、辱骂冒犯-10、忽视明确边界-5。它们是模型结合语境明确调用工具的判断依据，不触发关键词自动打分。

`mood.history({key,limit=50})` 返回{ok,items}，limit为1–500整数，按effectiveAt生效时间从新到旧。各项含at/effectiveAt/recordedAt/source/before/after/delta/reason及相应ruleId/proactiveId/messageId；source分别为model-adjustment、daily-first、unanswered。effectiveAt为真实入站/显式调整时间或未答dueAt，recordedAt保留实际获知记录的时间。迟到确认会在真实dueAt补入一次未答事件，按时间重算随后已有的固定扣10、每日max60和显式action/value；保留原事件字段，仅校正before/after/delta，仍在同一次状态写入中持久化。会话baseScore保留最初拥有的分值（旧导入0也有效），旧账本无history时使用其自有分值，绝不被新的默认值替换。不裁剪发送与入站去重凭据。

环境应在额度判断前调用 `mood.incoming({key,messageId,userId,at,hasText,hasImage,isSelf,directedAtBot,reengaged})`：先结清已到期等待，再对上海日历日首次非自身文本或图片做max(当前,60)，结清有效回应，最后判定欢迎。纯图片有效、空消息和自身消息无效；稳定messageId跨重启去重。私聊任何人类文本/图片有效；群聊仅直接回应bot或对应等待目标的消息有效，群聊每日首次恢复则适用于任何人类。

欢迎爆发由burstEnabled（默认true）和recoverMinutes（默认20，0–1440）管理。环境从主动互动阶段判断重回，传入可信且严格为true的reengaged；普通新消息本身不代表重回。只有当前normal形态、启用欢迎、冷却已过且无有效pending欢迎时创建一次welcomeBurstPending/lastBurstAt/activeUntil，不叠加、不因反复入站延长。正recoverMinutes同时作为欢迎有效窗口与冷却；0确实取消冷却，但pending仍保留固定5分钟安全有效期，避免无限期“刚回来”。状态与入站去重一起持久化。read的welcomeBurstActive还会检查当前形态、配置与now是否落在有效期；welcomeBurstUntil/cooldownUntil为时间戳，无历史欢迎时为null。失效只影响欢迎，不自动加分或解除其他发送约束。低落阈值唯一使用modeThreshold，不读旧lowThreshold别名。

确认成功投递后调用 `mood.sent({key,deliveryId,proactiveId,wakeReason,targetUserId,sentAt,success,expectsReply})`。只有success严格为true、expectsReply严格为true且reason为proactiveCheck/timeBubble/startupGreeting/privateFollowup才创建等待。普通回复、提醒、通知、未知或失败不创建等待。同会话同proactiveId只建一笔，分条及部分成功共享原截止时间。deliveryId与主动回合完成凭据长期保留，不盲目裁剪。

入站凭据仅保留key/at/userId/directedAtBot等判断所需事实，不保存正文。成功确认迟到时，按任何一条落在[sentAt,dueAt)的有效回应判断是否及时回答，不能只看最后一条；恰好dueAt已经属于晚回应。若只有晚回应，历史扣分仍保留，但真实回应可以结束该轮未答状态。旧的已经回答过的群聊等待不能永久授予原目标“清除新目标未答”的资格；实际直接回应仍有效。同一主动回合和已消费deliveryId重复确认不新增历史事件。

unansweredStreak按真实时间关系推导，不按确认到达顺序累加：最近断点取私聊最后人类消息（群聊取最后直接回应）与每笔已确认等待的首次有效firstReplyAt中的最大值，只计算已经实际结算且dueAt严格晚于断点的主动回合。等于截止时间时先扣分再被真实回应结束未答。等待的firstReplyAt（兼容旧answeredAt）一旦有值，旧目标再次发言不能推进它。settle、有效incoming与迟到确认后重算并持久化；老回合确认晚到不会复活较新回应已经结束的pleading，也不会抹去真正更新的另一目标未答。这个推导不改变导入基准或分值历史。

成功普通回复同样调用mood.sent，由环境将wakeReason规范为message（兼容reply），可另带originReason保留原触发事实；这种调用不要求proactiveId或expectsReply，不创建情绪等待。它只在确认成功、pending欢迎仍有效时消费一次，返回welcomeConsumed，稳定deliveryId防止旧回执消费下次欢迎。失败/未知、主动、日程和通知都不消费欢迎。超过有效期的成功普通回复不会伪称已完成欢迎。欢迎不改变心情或新增burstMax，由统一回复计划在现有casual形态上限内使用；环境须冻结当轮计划，首分条消费后仍按原合法计划完成，严肃内容优先。

`mood.settle({now})` 幂等扣分；onTick通过统一调度每分钟调用同一入口，不开启原生定时器。账本的dueAt/answeredAt/settledAt与分数同一次原子持久化，重复tick、热加载和重启不会重复扣分。

score≥modeThreshold（默认40，范围0–100）的mode为normal、band为playful；低于阈值为critical/reflective。normalName默认正太、criticalName默认AI，normalStyle/criticalStyle保存各形态短描述，read返回modeName与styleInstruction。阈值0始终normal，阈值100仅100分为normal。只有critical且0且存在未获回应的主动回合时为pleading：轻声请求，短碎句可变化，避免责备、威胁和逼迫。严肃任务始终先满足任务内容，不能用形态或恳求替代。

frequencyFactor=0.2+0.8*score/100，主动调度自己结合聊天意愿计算唯一静默概率与间隔；本组件不提供第二套intervalMultiplier。critical的replyCeiling为1，pleading为2；normal在[modeThreshold,100]区间前半为2、后半为3，100分总是3。因此默认阈值40时70分起3条，自定义阈值80时75分仍只1条。所有值仍服从公共发送限制。detailLevel依次为expanded/balanced/concise/gentle-fragments，由发送计划和风格组件消费。

原 `mood-users.record` 与 `mood-users.list` 服务身份及 `members` 数据保留为成员观察，仍最多保留最近200个用户状态；不再随时间漂移，也不作为第二个会话总心情来源。

2026-10-29 集成：index→ledger/history→policy 的 generation 参数逐级传播，热加载刷新拥有的帮助模块。导出纯 validateMoodConfig 校验正负规则数组、唯一ID、方向与分值范围、名称/说明类型；宿主对合并配置同步验证后才写入。AI工具 qq_mood 与桥接路由严格绑定当前会话token，工具开关为 socialV2.tools.mood。

群聊主动轮只采用首个明确的成功出站目标（@、已验证引用或戳一戳）。若首段无目标，可由后续独立成功分段填充一次，并从该段确认时间 targetFromAt 起认定该用户普通回复；先前发言不追溯合格，后续其他目标不替换，重复 deliveryId 不升级目标，已回应不重开。迟到的目标事实如证明截止前已应答，保留原未回应历史证据并标 voided，通过既有时间序列重放校正分值；不会产生新自动加分项。截止时或之后回应保留原扣分。
