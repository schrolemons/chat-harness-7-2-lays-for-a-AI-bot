import { parseGameInvitation, parseScheduledRelay } from '../../../src/relay-intent.js';

/** Classify real incoming text or a server-owned worker record. Callers own provenance. */
export function classifyTaskContent({text='',reason='',taskRecord}={}) {
 if(taskRecord && typeof taskRecord==='object' && taskRecord.id && taskRecord.sessionId && /^(private|group):[1-9]\d*$/.test(String(taskRecord.originKey)))return {eligible:true,kind:'worker',taskId:String(taskRecord.id)};
 const source=String(text).trim();
 if(!source || /^(?:startupGreeting|timeBubble|proactiveCheck|maintenance|memoryWrite|selfReview|timeout|replyCheck)(?::|$)/.test(String(reason)))return {eligible:false,kind:null};
 const relayInstruction=source.replace(/^(?:请(?:你)?|帮我|替我|麻烦(?:你)?|给我|去|(?:你|您)?(?:能不能|可以|能)(?:帮我)?)\s*/, '');
 if(/^(?:去)?群(?:聊|里)\s*(?:电一电|电一下|戳一戳|戳一下|拍一拍|拍一下)\s*[^，。！？；\n]+/.test(relayInstruction))return {eligible:true,kind:'relay'};
 const thirdParty=/^(?:转告|转达|传话(?:给)?|捎话(?:给)?|代发(?:给)?|发消息给|转发给|发给|告诉)(?!\s*(?:我|我们|咱|自己|本人))\s*\S+/;
 if(thirdParty.test(relayInstruction) || relayInstruction!==source&&/^(?:私聊|联系|通知|发送给)(?!\s*(?:我|我们|咱|自己|本人))\s*\S+/.test(relayInstruction))return {eligible:true,kind:'relay'};
 if(parseGameInvitation(source))return {eligible:true,kind:'relay'};
 if(parseScheduledRelay(source))return {eligible:true,kind:'calendar'};
 if(/^(?:设(?:置)?|定)(?:个|一个)?(?:提醒|闹钟|日程)/.test(relayInstruction))return {eligible:true,kind:'calendar'};
 // A time-qualified imperative can request a future contact without saying “set a reminder”.
 if(/(?:^|[，,。；;\n])\s*(?:请(?:你)?|你|帮我|麻烦你)?\s*(?:今晚|明晚|今天|明天|后天|晚上|早上|下午)?\s*(?:[零〇一二两三四五六七八九十\d]{1,4}(?:点|时)(?:半|[零〇一二两三四五六七八九十\d]{1,4}分)?|\d{1,2}:\d{2})(?:之后|以后|后|左右)?\s*(?:去.{0,24})?(?:联系|问候|安慰|哄|提醒|通知|转达)\S*/u.test(source))return {eligible:true,kind:'calendar'};
 if(/(?:建立|创建|添加|设置|安排|取消|删除|改期|更改|修改|调整|推迟|提前|提醒我|记得提醒).{0,50}(?:日程|提醒|闹钟|备忘|预约)|(?:日程|提醒|闹钟|备忘|预约).{0,30}(?:改到|取消|删除|改期|推迟|提前)|(?:把|将).{0,40}(?:日程|提醒|闹钟).{0,30}(?:改|取消|删除)|(?:明天|今天|后天|周[一二三四五六日天]|\d+点).{0,30}提醒我/.test(source))return {eligible:true,kind:'calendar'};
 if(/(?:查看|查询|查找|搜索|总结|汇总|整理|给我看|发我|发给我|看看|读一下|念一下).{0,60}(?:报告|记录|日记|日报|周报|任务结果|任务状态)/.test(source))return {eligible:true,kind:'report'};
 if(/^(?:请(?:你)?|帮我|替我|给我|麻烦(?:你)?|能不能(?:帮我)?|可以(?:帮我)?)[\s，,]*(?:执行|完成|处理|检查|修改|修复|分析|查找|搜索|整理|总结|翻译|编写|写|生成|制作|创建|建立|运行|测试|计算|下载|上传|安装|更新|查|找|做|画|读).+/.test(source))return {eligible:true,kind:'execution'};
 return {eligible:false,kind:null};
}
