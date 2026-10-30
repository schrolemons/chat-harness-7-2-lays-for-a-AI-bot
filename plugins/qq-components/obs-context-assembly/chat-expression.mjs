// Undo legacy transport-only voice promotion. The role file is never rewritten;
// current mood/voice belongs to late dynamic context, not the stable system prefix.
export function prioritizeChatExpression(input=[]) {
 const role=input.find(row=>row.id==='role-card'),dynamics=input.find(row=>row.id==='ctx-context-dynamics');
 const expression=dynamics?.chatExpression;
 const wasMerged=typeof role?.chatExpressionBaseText==='string';
 if(!wasMerged)return input;
 const baseText=wasMerged?role.chatExpressionBaseText:role.text;
 const dynamicText=expression?.text?expression.text+(dynamics.text?'\n\n'+dynamics.text:''):dynamics?.text;
 // Check against the exact owner-produced block, not a user-supplied heading.
 if(expression?.kind!=='selected-admin-style'||!expression.text?.trim())return input.map(row=>row===role?{...row,text:baseText,chars:baseText.length,parts:undefined,chatExpressionBaseText:undefined}:row);
 return input.map(row=>{
  if(row===role){
   const {chatExpressionBaseText:_base,parts:_parts,...rest}=row;
   return {...rest,name:'当前角色设定',source:'C · 人格与角色',text:baseText,chars:baseText.length};
  }
  if(row===dynamics){const text=dynamicText;return {...row,text,chars:text.length};}
  return row;
 });
}
