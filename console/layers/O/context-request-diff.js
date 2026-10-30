const toolName=t=>t.name||t.function?.name||'未命名工具';
const schema=t=>{const {chars:_chars,...definition}=t;return JSON.stringify(definition);};
const moduleValue=m=>JSON.stringify({text:m.text,parts:m.parts?.map(p=>({text:p.text,destination:p.destination})),included:m.included,inRequest:m.inRequest});
export function compareRequests(older,current){
 if(!older||!current)return null;
 const before=new Map((older.tools||[]).map(t=>[toolName(t),schema(t)])),after=new Map((current.tools||[]).map(t=>[toolName(t),schema(t)]));
 const prior=new Map((older.modules||[]).map(m=>[m.id,m]));
 return {toolsAdded:[...after.keys()].filter(name=>!before.has(name)),toolsRemoved:[...before.keys()].filter(name=>!after.has(name)),toolsChanged:[...after.keys()].filter(name=>before.has(name)&&before.get(name)!==after.get(name)),modulesChanged:(current.modules||[]).filter(m=>!prior.has(m.id)||moduleValue(prior.get(m.id))!==moduleValue(m)).map(m=>({id:m.id,name:m.name||m.id})),messageCharsDelta:(current.messageChars||0)-(older.messageChars||0),toolCharsDelta:(current.toolChars||0)-(older.toolChars||0)};
}
