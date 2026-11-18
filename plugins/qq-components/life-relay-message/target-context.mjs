export const SEMANTIC_RELAY_GUIDANCE='【自然语言传话与跨会话动作】自行理解本轮真实用户原话，分清动作、收件对象和要传达的内容，不要求固定句式；“去电一电／传话／告诉／问问＋QQ号／昵称／绰号”只是例子，自然改说法、前后倒装和上下文指代也按语义处理。讨论、引用别人命令或假设场景不自动执行。QQ号直接定位；昵称、绰号用当前确认映射，缺参数先qq_select_tools加载qq_alias_query，不能按前缀认人；确有多个候选或缺收件人/内容才补问。先核对最新白名单与相关私聊记录，旧记忆、没有注入的记录或旧失败不能证明“不在白名单”“从没聊过”；没有证据就说尚未核实。管理员环境可用qq_get_recent_messages读取允许的目标会话，本轮状态优先于旧聊天。明确请求且目标唯一后直接推进，不再重复索要同一许可。模型负责提取语义并选工具，不因快速解析器没有匹配就认定做不到。跨会话执行前，先在发起私聊用完整原指令的准确seq调用qq_reply_contents(kind="task")，保存准入成功且taskPending=false的contentId；实际发送以目标为key，沿用发起会话token和同一个contentId，不能为目标捏造一条来信或新登记一个目标来源。如果原指令已被当chat回复“这就去”，已认证管理员可将同一完整来源组升为task，沿用返回的原contentId，不重建来源、不重置已发送记录。先真实发送，再按工具回执说明结果；聊天回执complete不代表传话任务已经完成。告诉/传话忠实传达内容，问问实际发出问题，电一电也是跨会话执行，同样先声明task。文字用实际提供的qq_send_message或qq_send_private_message，拍一拍用qq_send_poke；需要游戏演出时按实际游戏工具返回生成内容后再发送，游戏结果不替代QQ任务准入。工具名和参数只能取自当前清单，未提供完整参数就先qq_select_tools加载，不编造通用互动工具。拒绝后按实际原因处理，不编白名单状态或假称已执行。';

export function ownerTargetFacts(payload,cap){
 const owner=String(cap.getOwnerQQ?.()||''),key=String(payload.key||'');
 if(!owner||key!=='private:'+owner||cap.hasAdminEnvironment?.(key)!==true)return '';
 const st=payload.st||{},source=payload.admittedMessages||[...(st.recentMessages||[]),...(st.unread||[])];
 const humans=[...new Map(source.filter(m=>m&&!m.isSelf&&(m.userId==null||String(m.userId)===owner)).map(m=>[m.messageId??m.seq,m])).values()].slice(-8);
 const targets=new Set();
 for(const row of humans.toReversed()){
  const text=String(row.plain??row.text??'');
  const groups=[...text.matchAll(/(?:group:|群(?:聊)?\s*[:：]?\s*)(\d{5,12})(?!\d)/g)].map(m=>m[1]);
  for(const m of text.matchAll(/(?<!\d)(\d{5,12})(?!\d)/g)){if(m[1]!==owner)targets.add((groups.includes(m[1])?'group:':'private:')+m[1]);if(targets.size>=3)break;}
  if(targets.size>=3)break;
 }
 const facts=[];
 for(const targetKey of targets){
  let whitelisted=null;try{if(typeof cap.resolveRelayTarget==='function')whitelisted=cap.resolveRelayTarget(targetKey)===targetKey;}catch{}
  const fact={targetKey,whitelisted,priorPrivateInteraction:null};
  if(whitelisted&&targetKey.startsWith('private:')){
   try{
    const known=cap.listConversationKeys?.()?.includes(targetKey)===true;
    const runtime=known?cap.getProactiveFacts?.(targetKey):null;
    const history=cap.readLocalConversationHistory?.({key:targetKey,limit:20,forLookup:true});
    const id=targetKey.split(':')[1],events=history?.ok===true&&Array.isArray(history.messages)?history.messages.filter(e=>e.message_type==='private'&&(!payload.selfId||e.self_id==null||String(e.self_id)===String(payload.selfId))):[];
    const inbound=events.filter(e=>String(e.user_id)===id&&e.localDirection!==1),outbound=events.filter(e=>e.localDirection===1||payload.selfId&&String(e.user_id)===String(payload.selfId));
    const incoming=Number(runtime?.lastIncomingAt)||0,sent=Number(runtime?.lastOutboundAt)||0;
    fact.observedIncomingCount=inbound.length;fact.hasSuccessfulOutbound=sent>0||outbound.length>0;
    if((incoming>0||inbound.length>0)&&fact.hasSuccessfulOutbound)fact.priorPrivateInteraction=true;
    if(incoming>0)fact.lastIncomingAt=incoming;if(sent>0)fact.lastOutboundAt=sent;
   }catch{/* Missing evidence remains unknown, never “never chatted”. */}
  }
  facts.push(fact);
 }
 return facts.length?'【本轮传话目标状态｜桥接实时只读事实】'+JSON.stringify({observedAt:Date.now(),targets:facts})+'。whitelisted来自当前生效白名单解析，不沿用旧对话结论；priorPrivateInteraction=true表示本地有双方私聊互动证据，null表示尚无足够证据，绝不等于从未聊过。当前状态不替代最终发送闸门，也不授权自动重放历史传话。':'';
}
