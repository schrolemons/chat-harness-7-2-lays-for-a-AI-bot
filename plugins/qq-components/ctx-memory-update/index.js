// 记忆更新插件：整理会话事实/今日画像/展示日记，事务通过独立工具按条目更新。
// 和 self-review 的分工：这里补充人物档案并整理会话记忆，不改代码、不改配置、不发 QQ。

const policyUrl = new URL('../ctx-memory-profile-facts/extraction-policy.mjs', import.meta.url);
policyUrl.search = new URL(import.meta.url).search;
const { PROFILE_EXTRACTION_POLICY } = await import(policyUrl.href);
const sourceUrl=new URL('./diary-source.mjs',import.meta.url);sourceUrl.search=new URL(import.meta.url).search;
const {diaryEvidence}=await import(sourceUrl.href);
const styleUrl=new URL('./diary-style.mjs',import.meta.url);styleUrl.search=new URL(import.meta.url).search;
const {DIARY_WRITING_POLICY}=await import(styleUrl.href);
const clockUrl=new URL('../ctx-memory-store/diary-delivery.mjs',import.meta.url);clockUrl.search=new URL(import.meta.url).search;
const {diaryTargetDay,diaryWindow,diaryDraftLimit}=await import(clockUrl.href);

export function createPlugin(ctx) {
  const maxChars = Math.max(800, Number((ctx.config || {}).maxChars) || 4000);
  return {
    hooks: {
      beforePrompt(payload) {
        if (String(payload?.reason || '') !== 'memoryWrite') return '';
        const normalize=text=>String(text||'').replace(/\s+/g,'').trim();
        const prior=(payload?.priorPromptModules||[]).some(row=>row.id==='ctx-memory-profile-facts'&&normalize(row.text).includes(normalize(PROFILE_EXTRACTION_POLICY)));
        const now=Number(payload.now)||Date.now(),config=ctx.capabilities?.memoryConfig?.()?.dailyDiary;
        const window=ctx.callService?.('memory','diaryDraftContext',{key:payload.key,now})||diaryWindow(diaryTargetDay(now,config),config);
        const evidence=diaryEvidence(payload.st,window,now);
        return [
          '【记忆更新｜补充人物档案并整理会话记忆，不发 QQ】',
          prior?'':PROFILE_EXTRACTION_POLICY,
          '先逐栏核对本会话重要事实、今日用户画像和可核实的入站原文；在当前权限内自动补充遗漏的人际关系与其他稳定信息，不必等用户再次要求整理。先完成 profile_get / profile_update 并确认成功，再输出完整会话记忆；权限不足或来源不明的只记待核实候选，不能跨会话猜测补写。',
          '现在整理本会话记忆。输出完整的标签块：重要事实只提交新增证据或有来源和日期的更正，不改写/复述已有事实；存储服务会合并保留旧事实。用户画像与日记提交完整最新内容，严格保留下面的标签：',
          '分工：QQ人物档案保存跨会话稳定资料，更新最慢、最权威；轻量记忆只保存当前话题、bot待说想法和短窗口行为印象，更新最快；有持续价值才提炼进入本会话重要事实，不整段复制、不跨会话搬运隐私。',
          '当前事务由 qq_task_note 独立管理。先 list 核对本会话活跃事项，再按 id/expectedRevision 用 upsert 更新同一条的状态、进度和下一步；新事项才新建。未完成、等待、完成、取消和被替代要区分；旧记录先核实，不因两小时未提及或日期变旧就完成/删除。不要把【未完成事项】再写入持久化记忆。',
          '重要事实中的随口安排、吃饭/活动约定可提炼成当前事务，不必一律建正式日程；只有明确时间和提醒需求才调用日程工具，事务里保留日程ID与状态，不维护第二份计时器。已消费的话题或待说想法可在成功提炼后用轻量记忆工具移除；未经核实不搬走仍在聊的话题。',
          '正式日程成功接管同一提醒后，将仅用于该提醒的事务标 superseded 并保留日程ID；若事务还包含独立待办，就只跟踪待办进度，不复制日程的提醒状态。日程取消不等于独立工作已完成。',
          '职责与权威：QQ人物档案 > 本人明确更正/会话有源事实 > 今日临时画像 > 窗口行为印象；本人明确更正先核对并更新档案，不能一边保留冲突旧档案一边让临时画像覆盖它。事实保留原话/玩笑的语境、来源和日期，不把bot感受或一次行为提升为稳定性格。',
          '<MEMORY>',
          '【重要事实】',
          '- （本会话中值得持续放在上下文中的新增重要事实：逐条保留有来源和日期的用户原话、玩笑、聊天喜好、明确约定和共同经历；没有新增就留空。旧事实由存储保留，不因改写重复追加；更正需注明原记录及新依据，过时配置/故障只标历史，不冒充当前状态）',
          '【用户画像】',
          '- （从今日重要事实提取的临时人物画像，注明对象、日期与依据；区分本人表达和推测，不因当天观察覆盖稳定档案。稳定信息经确认提炼后可向上更新QQ人物档案或冒泡时段；仅写候选不能声称已更新。历史候选保留原日期，不改写为今日行为）',
          '【日记】',
          '（提交本窗口经过取舍的完整日记成稿；跨窗口另起一份，不续写、润色或拼接昨天的日记。证据少就如实写少，不补编整天的经历。）',
          DIARY_WRITING_POLICY,
          '本次日记正文最多 '+(window.maxDiaryChars??diaryDraftLimit(window.day,config))+' 字。先选片段，再写完整短稿；超长就删掉次要片段、合并重复感受并重写，保留完整句意。超限稿不会保存或发送。',
          '允许结合历史聊天偶尔与昨天对比，但须明确写为旧事，不能说成今天刚发生。',
          '</MEMORY>',
          '【本次日记窗口】'+window.day+' 日记：'+window.start+' 至 '+window.end+'（北京时间，按消息发生时间归属；窗口未结束时只总结截至当前的部分）。',
          window.sameWindowDiary?'【同一窗口已有日记｜仅作素材，结合新消息重新取舍、合并和精简，不要求逐条保留；这不是上一窗口日记】\n'+window.sameWindowDiary:'【新日记窗口】没有本窗口日记，从可核实的本日行为开始写；不要拿昨天的日记填空。',
          '【本窗口当前可用行为证据｜不额外套用C层最近N条限制】'+(evidence.length?'\n'+evidence.map(m=>new Date(m.at).toISOString()+' '+m.sender+'：'+m.text).join('\n'):'没有可核实的新行为；不要虚构更新。'),
          `要求：简洁准确、不编造；总长不超过 ${maxChars} 字；**不要发任何 QQ 消息、不要调用发送工具**；输出这段后直接收尾。`
        ].filter(Boolean).join('\n');
      }
    }
  };
}
