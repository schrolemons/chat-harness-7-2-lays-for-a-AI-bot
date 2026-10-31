// Only the signed component's selected voice joins the administrator role slot.
// The role file is never rewritten; numeric mood and user material stay data.
export function prioritizeChatExpression(input=[],policy={}) {
 const role=input.find(row=>row.id==='role-card'),dynamics=input.find(row=>row.id==='ctx-context-dynamics');
 if(!role)return input;
 const base=typeof role.chatExpressionBaseText==='string'?role.chatExpressionBaseText:role.text;
 const old=role.parts?.find(part=>part.id==='ctx-context-dynamics:expression')?.text,expression=dynamics?.chatExpression;
 let text=dynamics?.text||'';
 if(old&&expression?.text===old&&!text.startsWith(old))text=[old,text].filter(Boolean).join('\n\n');
 const allowed=policy.enabled!==false&&!policy.disabled?.includes('ctx-context-dynamics')
   &&expression?.kind==='selected-admin-style'&&expression.text?.trim()&&text.startsWith(expression.text);
 if(!allowed){
  if(typeof role.chatExpressionBaseText!=='string')return input;
  const {chatExpressionBaseText:_base,parts:_parts,...plain}=role;
  return input.map(row=>row===role?{...plain,name:'当前角色设定',source:'C · 人格与角色',text:base,chars:base.length}:row===dynamics?{...row,text,chars:text.length}:row);
 }
 const voice=expression.text,combined=base+'\n\n'+voice,remainder=text.slice(voice.length).trim();
 return input.map(row=>row===role?{...row,name:'角色设定与本轮聊天示范',source:'C · 人格与角色 / 当前形态',text:combined,chars:combined.length,chatExpressionBaseText:base,
  parts:[{id:'role-card:original',name:'人设卡原文（只读）',text:base},{id:'ctx-context-dynamics:expression',name:'当前形态与完整示范',text:voice}]}
  :row===dynamics?{...row,text:remainder,chars:remainder.length}:row);
}
