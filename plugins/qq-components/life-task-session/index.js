// life-task-session（L 层｜任务委派会话）
//
// 让小鲸鱼能把「需要独立完成的任务」交给 DSH 里的一个**独立任务会话**：
//   · 会话挂在 DSH 的「小鲸鱼任务」工作区，主人在界面上可见；
//   · 任务会话用 qq-task-worker preset（本地工具 + 联网，无 QQ 工具），自己干活、
//     缺少输入时返回状态，由聊天协调器收集答案；
//   · 任务结束（汇报带 [任务完成] 标记）后，桥接把结果写回注册表并唤醒发起会话，
//     小鲸鱼用 task_result 取结果、自然地向主人转达。
//
// 本插件只做三件事：声明工具（转调桥接注入的 capabilities）、给主人会话注入用法提示、
// 提供 skill.md 说明。真正创建会话/跟随事件/捕获结果的机制在桥接里（环境管理）。
// Propagate the host generation to the policy dependency; ESM otherwise retains stale exports.
const policyUrl = new URL('./task-policy.mjs', import.meta.url);
policyUrl.search = new URL(import.meta.url).search;
const {buildTaskPrompt, taskTransition, taskEvent, taskRequest, settleDeferred, recoverTask} = await import(policyUrl.href);

export function createPlugin(ctx) {
  const notice = (item) => {
    const state = ctx.state?.get?.() || {};
    const pending = (Array.isArray(state.notices) ? state.notices : []).filter(x=>x.taskId!==item.taskId);
    pending.push({taskId:item.taskId,title:item.title,status:item.status,updatedAt:item.updatedAt});
    ctx.state?.set?.({...state,notices:pending.slice(-20)});
  };
  const acknowledge = (result) => {
    const state = ctx.state?.get?.() || {};
    ctx.state?.set?.({...state,notices:(state.notices || []).filter(x=>x.taskId!==result.taskId || x.updatedAt!==result.updatedAt)});
  };
  const need = (input) => {
    const token = String(input?.token ?? '').trim();
    if (!token) throw new Error('缺少会话令牌 token（见唤醒提示中的【会话令牌】）');
    return token;
  };

  ctx.registerTool('task_spawn', {
    description: '在 DSH 里启动一个独立任务会话（qq-task-worker，用户在界面可见）：把需要长时间、多步骤、或要独立完成的任务丢给它；它独立执行，缺少输入时返回状态；完成或待补充时桥接会唤醒你，你用 task_result 取结果再向主人汇报。仅管理员（主人）会话可用。',
    schema: {
      token: { type: 'string', description: '你的会话令牌（见唤醒提示中的【会话令牌】）' },
      title: { type: 'string', description: '任务标题（会显示在 DSH 工作区里，简短）' },
      task: { type: 'string', description: '任务说明：目标、背景、约束、期望产物，写清楚一点' }
    },
    handler: async (input) => {
      const token = need(input);
      const title = String(input?.title ?? '').trim().slice(0, 80) || '未命名任务';
      const task = String(input?.task ?? '').trim();
      if (!task) throw new Error('task 不能为空');
      const cap = ctx.capabilities;
      if (!cap || typeof cap.taskSpawn !== 'function') throw new Error('桥接未提供任务会话能力（capabilities.taskSpawn）');
      return cap.taskSpawn({ token, title, task });
    }
  });

  ctx.registerTool('task_list', {
    description: '列出你（管理员会话）启动过的任务会话：id、标题、状态（running/waiting_input/done/failed/cancelled）、创建时间与结果预览。仅管理员（主人）会话可用。',
    schema: { token: { type: 'string', description: '你的会话令牌' } },
    handler: async (input) => {
      const token = need(input);
      const cap = ctx.capabilities;
      if (!cap || typeof cap.taskList !== 'function') throw new Error('桥接未提供任务会话能力（capabilities.taskList）');
      return cap.taskList({ token });
    }
  });

  ctx.registerTool('task_result', {
    description: '取某个任务会话的结果：status（running/waiting_input/done/failed/cancelled）、汇报文本或错误信息。任务会话结束（带 [任务完成] 标记）后调用它，然后把结果自然地向主人转达。仅管理员（主人）会话可用。',
    schema: {
      token: { type: 'string', description: '你的会话令牌' },
      taskId: { type: 'string', description: 'task_spawn 返回的 taskId' }
    },
    handler: async (input) => {
      const token = need(input);
      const taskId = String(input?.taskId ?? '').trim();
      if (!taskId) throw new Error('taskId 不能为空');
      const cap = ctx.capabilities;
      if (!cap || typeof cap.taskResult !== 'function') throw new Error('桥接未提供任务会话能力（capabilities.taskResult）');
      const result = await cap.taskResult({ token, taskId });
      acknowledge(result);
      return result;
    }
  });

  ctx.registerTool('task_cancel', {
    description: '终止某个在跑的任务会话（取消当前回合并标记为 cancelled）。主人说「终止/停掉/取消/别干了」某个任务时用它。仅管理员（主人）会话可用。',
    schema: {
      token: { type: 'string', description: '你的会话令牌' },
      taskId: { type: 'string', description: '要终止的任务 taskId' }
    },
    handler: async (input) => {
      const token = need(input);
      const taskId = String(input?.taskId ?? '').trim();
      if (!taskId) throw new Error('taskId 不能为空');
      const cap = ctx.capabilities;
      if (!cap || typeof cap.taskCancel !== 'function') throw new Error('桥接未提供任务终止能力（capabilities.taskCancel）');
      return cap.taskCancel({ token, taskId });
    }
  });

  ctx.registerTool('task_input', {
    description: '给已有独立任务补充输入或回答问题，继续同一任务会话；仅主人会话可用，不要为同一任务重复 spawn。requestId 是本次输入的稳定唯一编号，重试必须复用。',
    schema: {token:{type:'string'}, taskId:{type:'string'}, input:{type:'string'}, requestId:{type:'string'},replyToRequest:{type:'string'},decision:{type:'string'},answers:{type:'array'}},
    handler: async (input) => {
      const token = need(input);
      if (typeof ctx.capabilities?.taskInput !== 'function') throw new Error('当前桥接尚未加载任务输入能力');
      return ctx.capabilities.taskInput({token, taskId:String(input?.taskId||''), input:String(input?.input||''), requestId:String(input?.requestId||''),replyToRequest:input?.replyToRequest,decision:input?.decision,answers:input?.answers});
    },
  });

  return {
    services: {'task-session': {prompt: buildTaskPrompt, transition: taskTransition, event:taskEvent, request:taskRequest, settle:settleDeferred, recover:recoverTask, notice}},
    hooks: {
      // 只给主人会话注入用法提示；其它会话（群/陌生人）既没有令牌也没有能力，不提示也不可用。
      // 用桥接在 collectPromptBlocks 里算好的 isOwnerKey 判定，不能拿 plugin.json 的 ownerQQ
      // （空占位）拼 key——那样永远匹配不上，提示永远不注入，这正是「让小鲸鱼干活却不另起会话」的根因。
      beforePrompt(payload) {
        if (/^(memoryWrite|slangLearn)$/.test(String(payload?.reason||''))) return '';
        if (!payload?.isOwnerKey) return '';
        const notices = ctx.state?.get?.()?.notices || [];
        if (notices.length) ctx.addPromptBlock('【待回传任务状态】逐项用 qq_task_result 核实并转达，不遗漏并行任务：'+JSON.stringify(notices));
        ctx.addPromptBlock('【小鲸鱼汇报任务】从第一句就保持角色卡里的温顺、腼腆、慢半拍和对哥哥的亲近，不突然变成公告员。先核实状态，再说真实进展：刚有进展时可以轻轻开心、带一点小得意；卡住时可以迟疑或小声懊恼，但马上讲清卡在哪里；做完时可以松口气、短短地高兴一下，再交代结果和产物。示例只校准节奏，不照抄事实：“诶，接上啦……我再看看它能不能发出去。”“唔，回执还没来，我不敢说它发成了。”“嘿嘿，成啦，图片真的到群里了。”熟悉的主人面前可偶尔叫哥哥，停顿或加一个轻巧的虚构动作；每条不必都有，不硬塞牛奶、大海或尾巴。用短而软的日常话讲清做到哪、阻碍、下一步和必要数字、路径、技术名词；不念 running/done 字段、不搬执行日志、不靠撒娇遮住事实、不讨论自己的说话规则。没查到就直说，别编。');
        return '【任务协调｜聊天与执行分离】你负责聊天、任务输入输出和状态管理。凡是需要执行命令、读写文件、浏览器操作、制作产物或连续多步处理的请求，必须调用 qq_task_spawn(token,title,task) 开独立工作会话，不在聊天会话执行。task 只写目标、必要背景、源文件位置、约束和验收要求；不要复制聊天历史、角色卡、语气规则、会话令牌、等待和唤醒配置。普通闲聊与无需执行操作的简短知识解答留在这里。任务在后台运行时继续正常聊天，各群聊独立，不因为主人任务而潜水、暂停其他会话或一直轮询。问进度先 qq_task_list，再按需 qq_task_result；新任务各自 spawn，同一任务的补充需求用 qq_task_input(token,taskId,input,requestId)，不重复开会话。waiting_input 表示需要输入：取出具体问题转达用户，收到回答后投递到对应 taskId；无法明确对应哪个任务时才澄清，不能猜。主人要求终止时 qq_task_cancel。task_result.pendingRequests 若有权限请求，先向用户说明具体操作；只有用户明确同意后才能用 qq_task_input 的 replyToRequest 和 decision=allowed-once 回答，拒绝用 rejected，不能自行批准。结构化问题按 questions 原编号提供 answers。done/failed/cancelled 均是终态，如实回报；聊天端不接手继续执行失败任务。只传达摘要、结论和产物位置，不把整个执行日志搬回聊天。';
      }
    }
  };
}
