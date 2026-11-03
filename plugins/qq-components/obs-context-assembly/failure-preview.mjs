// Shared display sanitization; never expose tool credentials in archive evidence.
function safeValue(value,depth=0){
 if(depth>8)return '[深层内容已省略]';
 if(typeof value==='string'){
  let parsed;try{parsed=JSON.parse(value);}catch{}
  if(parsed&&typeof parsed==='object')return safeValue(parsed,depth+1);
  return value.replace(/((?:token|secret|password|api[_-]?key|authorization|cookie)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,'$1[已隐藏]').replace(/\bBearer\s+[\w.+/=-]+/gi,'Bearer [已隐藏]');
 }
 if(Array.isArray(value))return value.map(row=>safeValue(row,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/token|secret|password|api[_-]?key|authorization|cookie/i.test(key)?'[已隐藏]':safeValue(item,depth+1)]));
 return value;
}
export function safeFailureText(value){const safe=safeValue(value);return typeof safe==='string'?safe:JSON.stringify(safe,null,2);}
