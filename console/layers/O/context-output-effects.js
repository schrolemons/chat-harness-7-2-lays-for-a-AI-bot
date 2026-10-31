// Read-only descriptions of verified storage contracts. Never infer a write from generated prose.
const categories={activeTopic:['当前话题','activeTopics','话题'],pendingThought:['待说想法','pendingThoughts','想法'],memberImpression:['行为印象','memberImpressions','印象']};
const sessionKey=key=>/^(private|group):\d{1,20}$/.test(key||'')?key:null;
export function storedToolEffect(name,args,payload,request={}){
 const outer=payload?.data;
 // PluginHost.callTool acknowledges dispatch separately from the actual handler outcome.
 const data=outer?.plugin&&outer.result&&typeof outer.result==='object'?outer.result:outer;
 const key=sessionKey(data?.key||args.key||request.key),profileId=String(data?.userId||args.userId||'');
 const failed=payload?.isError||outer?.ok===false||outer?.error||data?.error;
 let effect=null,confirmed=false,read=false,unchanged=false;
 if(['profile_get','profile_update','profile_delete'].includes(name)){
  read=name==='profile_get';unchanged=data?.changed===false&&!data?.error||data?.deleted===false;
  confirmed=name==='profile_update'?data?.ok===true&&data.changed===true:name==='profile_delete'?data?.ok===true&&data.deleted===true:data?.ok===true;
  effect={title:'QQ 人物档案',badge:'档案',storage:'state/person-profiles.json',field:(/^\d+$/.test(profileId)?'profiles['+profileId+']':'目标 QQ 档案')+(name==='profile_update'?' · '+[...Object.keys(args.profile||{}),...(Array.isArray(args.deleteKeys)?args.deleteKeys:[])].join('、'):''),action:read?'读取':name==='profile_delete'?'删除':'更新'};
 }else if(name==='qq_memory_append'){
  const category=categories[args.category||data?.category];
  if(category){effect={title:'轻量记忆 · '+category[0],badge:category[2],storage:'state/social-v2.json',field:(key?key+' · ':'')+category[1],action:'追加'};confirmed=data?.ok===true&&data.category===(args.category||data.category);}
 }else if(name==='qq_task_note'){
  read=args.action==='list';confirmed=data?.ok===true&&(read||!!data.item);
  effect={title:'会话事务',badge:'事务',storage:key?'state/memory/affairs/'+key.replace(':','_')+'.json':'state/memory/affairs/<会话key>.json',field:data?.item?.id||args.id||'事务条目',action:read?'读取':'更新'};
 }else if(name==='qq_schedule'){
  read=args.action==='list';unchanged=data?.duplicated===true;
  confirmed=data?.ok===true&&(read||!!data.item||!!data.removed);
  effect={title:'日程安排',badge:'日程',storage:'state/plugins/life-schedule-reminder.json',field:[key,data?.item?.id||data?.removed?.id||args.id].filter(Boolean).join(' · '),action:read?'读取':args.action==='cancel'?'取消':args.action==='complete'?'完成':'更新'};
 }else if(name==='qq_mood'){
  confirmed=data?.ok===true&&Number.isFinite(data?.score)&&Number.isFinite(data?.before);
  effect={title:'心情账本',badge:'心情',storage:'state/plugins/ctx-user-mood.json',field:'mood.conversations'+(key?'['+key+']':'')+' · score / history',action:'更新'};
 }else if(name==='qq_report_message_receipts'||name==='qq_mark_read'){
  const reporting=name==='qq_report_message_receipts';unchanged=reporting?data?.updated===0:data?.markedCount===0;
  confirmed=data?.ok===true&&(reporting?Array.isArray(data.receipts):Number.isSafeInteger(data.markedCount)&&data.markedCount>0);
  effect={title:reporting?'QQ 收件双戳':'QQ 已读水位',badge:'收件状态',storage:'state/social-v2.json',field:(key?key+' · ':'')+(reporting?'逐消息收件状态 / seenAt / repliedAt':'已读水位 / seenAt'),action:'更新'};
 }
 if(!effect)return null;
 const status=!payload?'pending':failed?'failed':unchanged?'unchanged':data?.ok===false?'failed':confirmed?(read?'read':'confirmed'):'unverified';
 const outcome=status==='pending'?'已请求'+effect.action+'，尚无对应返回':status==='failed'?'工具未确认'+effect.action+(data?.error||outer?.error?'：'+String(data?.error||outer?.error):'成功'):status==='unchanged'?'返回确认没有新增变更':status==='read'?'只读返回，未写入此资料':status==='confirmed'?'工具回执确认'+effect.action+'成功':'未采集足以确认此项'+effect.action+'的返回字段；可能转入其他处理路径';
 return {kind:'storage',...effect,status,outcome,verified:status==='confirmed'};
}
