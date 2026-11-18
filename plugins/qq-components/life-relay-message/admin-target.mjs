import {parseRelayCommand,stripRelayPrefix} from '../../../src/relay-intent.js';
// A recognized explicit destination remains binding in the owner environment.
// Unrecognized wording still uses the existing semantic/admin workflow.
export function validateExplicitAdminTarget({messages=[],targetKey,resolve}={}){
 const targets=new Set();for(const m of messages){
  const plain=stripRelayPrefix(m.plain??m.text??'');
  const command=plain.replace(/^(?:去)?私聊(?:里)?\s*(?:电一电|电一下)?\s*/,'告诉').replace(/^(?:去)?(?:电一电|电一下)\s*/,'告诉');
  const request=parseRelayCommand(command,{resolve:name=>!!resolve?.(name),preferLongest:true});
  if(request){const key=resolve?.(request.name);if(key)targets.add(key);}
 }
 if(targets.size&&!targets.has(targetKey))return {ok:false,error:'CROSS_SESSION_TARGET_MISMATCH：原指令已明确收件人，请使用该收件人的当前白名单会话；不要把内容转给其他人。'};
 return {ok:true,explicit:targets.size>0};
}
