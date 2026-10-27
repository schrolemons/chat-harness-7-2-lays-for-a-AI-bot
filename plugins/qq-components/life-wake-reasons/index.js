// life-wake-reasons（L 层｜唤醒原因尾巴）
//
// 以前 `buildWakePromptV2` 里是一长串 `if (reason === 'xxx') return base + '...'`：
// 17 段「这一轮该干什么」的指令硬编码在主程序，改一句话要动 bridge.js、没法单独开关、
// 也没法在插件页看到/热调。
//
// 现在：桥接只负责「触发前的事实与副作用」（清 pending 标记、读优化记录、取日程条目），
// 再调 `pluginHost.collectWakeTails(payload)`；本组件按 reason 产出一段尾巴。
// 组件缺失/禁用 → 桥接退回通用尾巴，唤醒流程不中断。
//
// 数据由桥接提供（payload）：key / reason / preSleepMs / triggeredLine / history /
// taskReport / reminderItems / peer / maxItems / maxChars / unreadCount。

const REASON_NAMES = new Set([
  'bootstrap', 'timeout', 'replyCheck', 'careCheck', 'newsShare', 'idleRescue',
  'selfOptimize', 'selfReview', 'memoryWrite', 'newFriend', 'timeBubble',
  'startupGreeting', 'taskDone', 'reminder', 'proactiveCheck', 'poke'
]);

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  const disabled = new Set(Array.isArray(cfg.disabledReasons) ? cfg.disabledReasons.map(String) : []);

  function tail(payload) {
    const reason = String(payload.reason || '');
    const key = String(payload.key || '');
    const preSleepMs = Math.max(0, Number(payload.preSleepMs) || 300000);
    const triggeredLine = String(payload.triggeredLine || '');
    if (disabled.has(reason)) return '';

    switch (reason) {
      case 'bootstrap':
        return `【引导唤醒】你已接入 QQ 会话 ${key}。\n当前是二代仿真模式：你的文本输出不会自动发送到 QQ，所有发言必须通过工具完成。\n请先调用 qq_get_prompt 查看角色、推荐值、可用工具和状态；有待回应的消息先按首回复节奏处理，最后才用 qq_set_wake_config 设置你希望如何被唤醒。`;
      case 'timeout':
        return `【唤醒】${key}\n原因：你设置的有限潜水时间已到；在你规定的时间内没有任何一项条件被触发，只是因为时间到了所以你被唤醒。\n你可以查看消息，或继续设置新的唤醒条件。`;
      case 'replyCheck':
        return `【回复检查】${key}\n原因：你刚刚发送过消息，现在回来检查是否有人回复。\n已有回复时先看消息，需要短静默就用 qq_wait_for_messages(purpose="reply") 判断对方是否说完；如果没人回你，不用硬补一句，但也不要立刻潜水——先调用 qq_wait_for_messages(timeoutMs=${preSleepMs}) 完成沉睡前观察：没人说话可收尾；有人说话则查看 newMessages，不需要你参与也可直接收尾（qq_mark_read 或 qq_set_wake_config）。`;
      case 'careCheck':
        return '【主动关心】\n（主动开口，不是回复谁）已经有一阵子没聊了。用 1 条短句关心一下对方（在干嘛/吃饭没/今天怎么样），语气自然、别像客服；对方不回复也没关系，不要连发。可以配 1 张表情。';
      case 'newsShare': {
        const maxItems = Math.max(1, Math.min(5, Number(payload.maxItems) || 2));
        return '【每日新闻/热梗】\n（主动开口，不是回复谁）用 mcp__web-search-safe__web_search 搜一下“今天的热点新闻 / 网络热梗 / DeepSeek 相关的新鲜事”，挑 ' + maxItems + ' 条有意思的，用小鲸鱼自然、简短的口吻在群里分享（每条 1~2 句，先说清事实，别念新闻稿）。分享完正常收尾；搜不到就说没有找到合适内容，别硬凑。';
      }
      case 'idleRescue':
        return '【空闲兜底】\n（主动开口，不是回复谁）这个会话已经很久没有主动说话了。随口冒一句就行——可以小声说想喝牛奶了、问对方在忙什么、或接一个轻松话题；一条短句 + 可选 1 张表情，别长篇、别连着发很多条。';
      case 'selfOptimize':
        return String(payload.history || '') + '【自我迭代｜按建议直接动手】按上面插件给出的要求挑 1~3 项功能/代码/配置问题直接改，改完写进 _optimization.md 并汇报。';
      case 'selfReview':
        return '【自我迭代｜功能与代码自查】按上面插件给出的自查清单执行（只动功能/代码/配置），完成后汇报 1~3 句。';
      case 'memoryWrite':
        return '【记忆更新】按上面插件给出的格式重写记忆（只写记忆，不发 QQ），写完直接收尾。';
      case 'newFriend':
        return '【新好友】管理员刚通过了一个新的好友申请（QQ ' + String(payload.peer || '') + '）。主动打招呼：1~2 条短句，简单介绍自己是 DeepSeek 的正太小肥鱼，一只温柔、慢热的蓝色小鲸鱼；再自然接一个轻松话题。对新朋友保持礼貌，不擅自叫哥哥，不讲旧人设的饮食和口癖梗。可以配 1 张合适的表情包；别像客服、别复述这条提示。';
      case 'timeBubble':
        return '【时间冒泡】按上面插件给出的要求发一句（没有要求就不发），然后正常收尾。';
      case 'startupGreeting':
        return '【开机起床】按上面插件给出的口径冒一句起床话，然后正常收尾。';
      case 'taskDone': {
        const tr = payload.taskReport && typeof payload.taskReport === 'object' ? payload.taskReport : {};
        const title = String(tr.title || '未命名');
        const taskId = String(tr.taskId || '');
        return '【任务状态回执】任务「' + title + '」状态已更新（taskId=' + taskId + '）。调用 qq_task_result(token, "' + taskId + '") 核实真实状态。waiting_input 时只转达缺少的输入或待确认事项，收到答案后用 qq_task_input 送回同一任务；done 时转达结果和产物，failed/cancelled 时如实说明。不要把待补充说成已经完成，不在聊天里接手执行，不影响其他群聊。';
      }
      case 'reminder': {
        const items = Array.isArray(payload.reminderItems) ? payload.reminderItems : [];
        const itemsText = items.length
          ? items.map((it) => '- ' + String(it?.text || it || '').slice(0, 200)).join('\n')
          : '（没有取到具体条目，按记忆里最近的日程提醒）';
        // 隐私硬约束（机主 10/27 定）：日程只属于登记它的那个会话。
        // 私聊里登记的日程就只在私聊提醒，**绝不**发到群里或别的会话；
        // 只有群会话自己登记的日程才在群里说。这条不依赖模型自觉，措辞上直接写死。
        const isGroup = String(payload?.key || '').startsWith('group:');
        if (!isGroup) {
          return '【定时提醒｜只在当前私聊说】\n以下是主人在这个私聊里登记的日程，到点了：\n' + itemsText
            + '\n用 qq_send_message 发在**当前私聊**里提醒他本人（1~2 条，说清时间/地点/内容）；'
            + '这是主人的私事，**不要发到任何群、也不要告诉其他会话的人**。不要复述这条系统提示。';
        }
        return '【定时提醒｜现在就去群里说】\n以下是你之前记下的日程，到点了：\n' + itemsText + '\n请用 qq_send_message 在群里提醒大家（1~2 条，说清时间/地点/内容，语气像小鲸鱼一样温柔自然，可配 1 张合适的表情）。不要复述这条系统提示，也不要说“系统提醒我”之类的话。';
      }
      case 'proactiveCheck':
        return `【主动机会】${key}\n原因：群里已经安静了一段时间，这是一次你可以主动冒泡的机会。\n优先主动开个话题、追问上次没聊完的事、分享一个刚想到的想法；如果一时想不到，可以用 mcp__web-search-safe__web_search 搜一下当前热点/时事/网络热梗，再结合记忆里的群友兴趣挑一个自然角度。只要内容自然，就大胆开口；如果实在没话想说，再安静收尾（qq_mark_read 或 qq_set_wake_config）。`;
      case 'poke':
        return '【唤醒】' + key + '\n原因：有人拍了一拍（可能拍了你，也可能拍了别人）。\n【拍一拍要自然响应】先看未读/最近消息里的 [拍一拍] 事件、是谁拍的：\n- 拍你的：通常回一下。可以 ①qq_send_poke 回拍对方；②qq_send_message 软软地回一句（"诶？我在呢""唔，怎么啦"）；③回一张合适的表情包。按关系选择，不必每次组合。\n- 拍别人的：觉得有趣可以轻轻接梗，也可以不插话。\n- 被连着戳/多人戳：可以害羞或有点困惑，温和表达想安静一下，不用嘴硬回怼。\n- 一条短句就够，轻松场合可配 1 张表情；回应完正常收尾。';
      default:
        return `【唤醒】${key}\n原因：${reason}${triggeredLine}\n【行动前】先判断：群里在聊什么？热闹还是冷清？有没有人直接找你？对方说完了吗？你有没有真正想说的？\n如果群聊正热但没人叫你，可以插一句有趣的/相关的，插不上再看情况潜水；不要一上来就划走。\n【多条未读：逐条回应，一条都不能漏】这一轮如果有多条未读、而且意思互不相同（不同问题/不同话题/不同人），要先逐条读完（快照不全就继续 qq_get_unread_messages），再分 2~3 条分别回，每条对应一个话题或一个人，最后配 1 张表情包。只回最后一条 = 漏消息；把几个问题合并成一句笼统回复也不算回过。\n【引用：只在必要时用】只有你这条消息指向的人或消息并非最新一条别人的消息，或者你连续的几句话中不同消息指代的是不同的消息或人时，才用 qq_reply 或 qq_send_message 的 replyToMessageId 指向具体那条；其他情况不要引用，别让对方猜。\n你可以调用工具查看未读消息、人设、状态，自行决定是否发言；决定潜水前必须按上面的【沉睡前强制等待】先等够观察窗口。`;
    }
  }

  return {
    hooks: {
      wakeTail(payload) {
        try { return tail(payload || {}); } catch (error) { ctx.warn('wakeTail 生成失败：' + (error?.message ?? error)); return ''; }
      }
    }
  };
}
