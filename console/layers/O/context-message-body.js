import {esc} from '../../shared/api.js';
// Render only captured fields. A resolved quote is different from the incoming
// message's own plain text; neither can silently replace the other.
export function messageBodyParts(row={}){
 const text=typeof row.plain==='string'?row.plain:typeof row.text==='string'?row.text:typeof row.tail==='string'?row.tail:'';
 let quoted=row.quoted&&typeof row.quoted.text==='string'?row.quoted:null;
 if(!quoted&&typeof row.plain==='string'&&typeof row.text==='string'&&row.text!==row.plain&&row.text.startsWith('[引用')){
  const complete=row.text.endsWith(row.plain),prefix=(complete?row.text.slice(0,row.text.length-row.plain.length):row.text).trim();
  const resolved=prefix.match(/^\[引用(?:（[^）]*）)?\s+([^：:]+)[：:]([\s\S]*)\]$/);
  quoted={sender:row.quoteTargetIsSelf?'AI助手':resolved?.[1]?.trim()||'原消息',text:resolved?resolved[2]:prefix,previewOnly:!complete};
 }
 return {text,quoted};
}
export function quoteBodyHtml(quoted){
 if(!quoted)return '';
 const sender=quoted.sender,name=sender&&typeof sender==='object'?sender.card||sender.nickname||sender.name||sender.user_id:sender;
 return '<blockquote><strong>引用 '+esc(name||'原消息')+'</strong><p>'+esc(quoted.text)+'</p>'+(quoted.previewOnly?'<small>引用片段</small>':'')+'</blockquote>';
}
