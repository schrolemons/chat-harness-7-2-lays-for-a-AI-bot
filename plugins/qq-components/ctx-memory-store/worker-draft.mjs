// Accept complete JSON only. Some models return the two disjoint fields as
// adjacent objects; join those fields without repairing or discarding content.
export function decodeMemoryDraft(raw,{maxChars=4000}={}){
 const text=String(raw||'').trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/i,'$1').trim();
 if(!text||text.length>maxChars*4+100000)throw Error('整理草稿为空或超出接收上限');
 const draft={};let start=0,count=0;
 while(start<text.length){
  while(/\s/.test(text[start]||'')&&start<text.length)start++;if(start===text.length)break;
  if(text[start]!=='{'||++count>2)throw Error('整理草稿必须是完整JSON对象');
  let end=-1,depth=0,quoted=false,escaped=false;
  for(let i=start;i<text.length;i++){const c=text[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){end=i+1;break;}}
  if(end<0)throw Error('整理草稿JSON被截断');
  const part=JSON.parse(text.slice(start,end));
  for(const key of Object.keys(part)){if(!['memory','profileUpdates'].includes(key)||Object.hasOwn(draft,key))throw Error('整理草稿字段未知或重复：'+key);draft[key]=part[key];}
  start=end;
 }
 if(typeof draft.memory!=='string'||!Array.isArray(draft.profileUpdates)||draft.profileUpdates.length>100)throw Error('整理代理未返回完整合规草稿');
 let body=draft.memory.trim();
 if(body.startsWith('<MEMORY>')&&body.endsWith('</MEMORY>'))body=body.slice(8,-9).trim();
 if(/[<]\/?MEMORY[>]/i.test(body)||!/^【重要事实】[\s\S]*\n【用户画像】[\s\S]*\n【日记】[\s\S]*$/.test(body)||['【重要事实】','【用户画像】','【日记】'].some(h=>body.split(h).length!==2))throw Error('整理草稿的记忆三栏或标签不完整');
 const memory='<MEMORY>'+body+'</MEMORY>';if(memory.length>maxChars)throw Error('整理草稿超过记忆字数限制');
 return {...draft,memory};
}
