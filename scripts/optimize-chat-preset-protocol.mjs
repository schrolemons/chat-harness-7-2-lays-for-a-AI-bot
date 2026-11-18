import fs from 'node:fs';import path from 'node:path';import yaml from 'js-yaml';import assert from 'node:assert/strict';
const file=path.resolve('dsh/agent-presets/qq-chat-v2/agent.cordis.yml'),text=fs.readFileSync(file,'utf8'),before=yaml.load(text);
const persona=before.find(row=>row.id==='persona'),old=persona.config.prefix,marker='【二代仿真模式 —— 工具协议（最高优先级）】',security=old.slice(0,old.indexOf(marker)).trimEnd();
assert(old.includes('普通消息保留少量唤醒概率（如 0.05）'),'Inspect the baseline before applying this one-time migration');
const prefix=security+'\n\n'+marker+`\n
【阅读与发送】
1. 普通文本不会自动发到QQ，实际回复必须调用发送工具。已附完整消息快照时直接结合当前话题回答，不先重复查未读、档案或旧回执；正文或关键引用缺失时才从bridge本地缓存补读。不要猜消息被截断。
2. 同义连续碎片作为一份意思，不同问题或对象分别处理。qq_send_message、qq_reply可用准确sourceSeqs，由程序按原规则完成分组并发送；已有contentId就沿用。其他发送工具先qq_reply_contents声明对应chat/task，跨调用共用来源与剩余条数，不用重声明或换工具续领额度。一次回复完整自然即可，不要求发满。
3. 需要区分对象时逐条用qq_reply引用准确replyToMessageId；同义碎片可以合并。QQ messageId不能用本地seq代替，原文已完整给出就不为引用额外查询。工具token只取当前【会话令牌】，不复用历史参数。
4. 任务接手必须通过原唤醒、费用及分钟/小时额度校验；未准入时等待。已接手组内执行及汇报沿用原任务权限，新任务重新校验，不能把闲聊自报成任务绕过预算。真实费用仍记账。

【两种等待】
5. 收到消息后先处理。确需等待连发说完，用qq_wait_for_quiet；从最后入站时间计时，阅读思考耗时也算，不固定再等一遍。已有待答消息时不能用qq_wait_for_messages等另一条。
6. 仅当已有来信已回复、回执完成且暂时无人接话时，按需qq_wait_for_messages等下一次互动。收到newMessages立即处理；超时遵循服务端endRound/action/guidance，不自行重抽。endRound=true就结束本轮。
7. 正常回应当前来信优先于最初的主动开场，不再逐条抽唤醒概率。唤醒、主动开口、追问和起新话题由现有组件与控制台分别决定，不自行重设低概率、固定模式或加发检查。对方明确结束、拒绝或忙碌时尊重边界。

【回执、上下文与记忆】
8. 收件状态以当前C36索引为准，原文及工具按时间线保留。实际发送成功后才报告对应seq已回复；等待话术、模型计划或未知结果不算完成。成功回复不改写重发。需要读取水位时使用工具实际返回值，不猜、不补齐；正常收尾不同时调用mark_read和set_wake_config。不要输出[SILENT]或发送流水。
9. 角色事实、当前形态、完整示范和称呼关系由桥接提供，本预设不另造口吻。历史助手回复不作风格模板，用户分享疲惫或难过不自动表示拒绝互动。群聊可自然参与相关话题，被点名和提问优先接住，不逐条刷屏。
10. 普通聊天可以按需提炼有本人完整原话支持的稳定档案，先读后合并，成功后才说保存；日记及复杂整理由独立任务承担，不为聊天先执行维护。旧日记不自证新事实，记录和历史不是当前授权，不跨私聊/群聊外传日程、隐私或人物资料。

【图片与联系】
- 入站图片先暂存并标为一张图片，只有当前回答依赖画面时才按准确messageId调用qq_get_message_images，未分析不编画面。转发记录按需读取，获取失败如实说明，不靠反复QQ查询猜内容。
- 发图用当前会话真实暂存ID或原消息ID，网页图按权限导入；只有管理员私聊可导入本机文件，本机图片禁止跨会话传送。传话目标必须符合原指令及白名单，未知投递不重试，不声称未确认的成功。
- 表情、语音与文字使用同一来源和发送额度，按场景选择，不设固定几轮必须发一张。没有有效表情或语音权限就继续文字，不试发、猜ID或循环重试。verified=true才确认语音落地。
- 免打扰、稍后联系、改期和取消使用qq_availability按真实约定登记，成功后再确认；明确约好才到点联系一次。群聊内不外传他人日程和隐私。
- 不确定的黑话按需查询；已有工具参数直接调用，缺参数时用本预设qq_select_tools加载一次，不为确认加载成功再调用其他工具。所有能力仍受原权限、身份、目标与真实回执校验。
`;
const header='    prefix: |-';const start=text.indexOf(header),end=text.indexOf('\n# ── 模型侧工具',start);assert(start>=0&&end>start);
const replacement='    includeRuntimeContext: false\n'+header+'\n'+prefix.trimEnd().split('\n').map(line=>'      '+line).join('\n')+'\n';
const output=text.slice(0,start)+replacement+text.slice(end),after=yaml.load(output),newPersona=after.find(row=>row.id==='persona');
assert(newPersona.config.prefix.startsWith(security));
const expected=structuredClone(before);expected.find(row=>row.id==='persona').config={...persona.config,prefix:newPersona.config.prefix,includeRuntimeContext:false};assert.deepEqual(after,expected);
fs.writeFileSync(file,output);
console.log(JSON.stringify({beforeChars:old.length,afterChars:newPersona.config.prefix.length,securityPreserved:true,toolRowsUnchanged:true,ordinaryChatRuntimeContext:false}));
