// Shared policy for learned knowledge. Collection provenance is not applicability.
export const validSessionKey = key => /^(?:group|private):[1-9]\d{0,19}$/.test(String(key||''));
const fold = text => String(text??'').normalize('NFKC').trim().toLowerCase();
export function sourceKeys(value=[]) {
  if(!Array.isArray(value)||value.length>50||value.some(key=>!validSessionKey(key)))throw Error('适用会话须为最多50个 group:群号 或 private:QQ号');
  return [...new Set(value.map(String))];
}
export function migrateScope(entry) {
  const evidence=Array.isArray(entry.evidence)?entry.evidence:[];
  const originKey=validSessionKey(entry.originKey)?entry.originKey:validSessionKey(entry.sourceKey)?entry.sourceKey:evidence.find(e=>validSessionKey(e?.key))?.key||'';
  const keys=Array.isArray(entry.sourceKeys)?entry.sourceKeys:[entry.sourceKey,...evidence.map(e=>e?.key)].filter(validSessionKey);
  const next={...entry,originKey,sourceKeys:[...new Set(keys.filter(validSessionKey).map(String))].slice(0,50)};
  delete next.sourceKey;
  return next;
}
export const appliesHere=(entry,key)=>validSessionKey(key)&&Array.isArray(entry.sourceKeys)&&entry.sourceKeys.includes(key);
const names=(entry,kind)=>kind==='term'?[entry.term,...(entry.aliases||[])]:kind==='alias'?[entry.alias]:[entry.content];
const confirmed=(entry,kind)=>entry.status==='confirmed'&&(kind==='alias'?/^\d{5,12}$/.test(String(entry.qq||''))&&!!entry.alias:kind==='term'?!!String(entry.term||'').trim()&&!!String(entry.summary||'').trim():!!String(entry.content||'').trim()&&!!String(entry.meaning||'').trim());
const rank=(a,b)=>(Number(b.count)||0)-(Number(a.count)||0)||(Number(b.updatedAt)||Date.parse(b.updatedAt)||Number(b.at)||0)-(Number(a.updatedAt)||Date.parse(a.updatedAt)||Number(a.at)||0);
export function injectLimit(value,fallback) {
  return value!==undefined&&Number.isFinite(Number(value))?Math.max(0,Math.min(40,Math.floor(Number(value)))):fallback;
}
export function defaultEntries(entries,kind,key,limit) {
  return entries.filter(e=>confirmed(e,kind)&&appliesHere(e,key)).sort(rank).slice(0,injectLimit(limit,0));
}
export function semanticEntry(entry,kind,key) {
  const fields=kind==='term'?['id','term','topic','category','summary','aliases','sources','status']:kind==='alias'?['id','alias','qq','status']:['id','content','meaning','usage','risk','status'];
  return {...Object.fromEntries(fields.filter(k=>entry[k]!==undefined).map(k=>[k,entry[k]])),appliesHere:appliesHere(entry,key)};
}
function exactQuery(entry,kind,q) {
  return !!fold(q)&&(names(entry,kind).some(name=>fold(name)===fold(q))||kind==='alias'&&String(entry.qq)===String(q).trim());
}
export function queryEntries(entries,kind,{key,q=''}={}) {
  if(!validSessionKey(key))return {ok:false,error:'请选择有效的当前会话'};
  const needle=fold(q);
  const rows=entries.filter(e=>confirmed(e,kind)&&(appliesHere(e,key)
    ? !needle||[...names(e,kind),e.qq,e.topic,e.summary,e.meaning,e.usage].some(s=>fold(s).includes(needle))
    : exactQuery(e,kind,q))).sort((a,b)=>Number(appliesHere(b,key))-Number(appliesHere(a,key))||rank(a,b));
  return {ok:true,entries:rows.slice(0,50).map(e=>semanticEntry(e,kind,key))};
}
export function changeCurrentSource(entries,{key,id,action}={}) {
  if(!validSessionKey(key)||!['include_here','exclude_here'].includes(action))return {ok:false,error:'仅支持增删当前会话的适用关系'};
  const entry=entries.find(e=>e.id===id);
  if(!entry||entry.status!=='confirmed')return {ok:false,error:'只能调整已确认条目的适用会话'};
  let keys;
  try{keys=sourceKeys(entry.sourceKeys||[]);keys=sourceKeys(action==='include_here'?[...new Set([...keys,key])]:keys.filter(k=>k!==key));}catch(error){return {ok:false,error:error.message};}
  const changed=JSON.stringify(keys)!==JSON.stringify(entry.sourceKeys||[]);
  if(changed){entry.sourceKeys=keys;entry.updatedAt=Date.now();entry.revision=(Number(entry.revision)||0)+1;entry.sourceChanges=[...(entry.sourceChanges||[]),{key,action,at:Date.now()}].slice(-20);}
  return {ok:true,id,action,changed,appliesHere:keys.includes(key)};
}
function occurs(text,name) {
  const haystack=fold(text),needle=fold(name);if(!needle)return false;
  let start=haystack.indexOf(needle);
  while(start>=0){const before=haystack[start-1]||'',after=haystack[start+needle.length]||'';
    if(!(/[a-z0-9_]/.test(needle[0])&&/[a-z0-9_]/.test(before))&&!(/[a-z0-9_]/.test(needle.at(-1))&&/[a-z0-9_]/.test(after)))return true;
    start=haystack.indexOf(needle,start+1);
  }return false;
}
export function lookupHints(entries,kind,{key,incomingText='',userIds=[],injected=[]}={}) {
  const selected=new Set(injected.map(e=>e.id)),subjects=new Set(userIds.map(String));
  const matches=entries.filter(e=>confirmed(e,kind)&&!selected.has(e.id)&&(names(e,kind).some(name=>occurs(incomingText,name))||kind==='alias'&&subjects.has(String(e.qq)))).slice(0,6);
  if(!matches.length)return '';
  const tool={term:'qq_term_query',alias:'qq_alias_query',slang:'qq_slang_query'}[kind];
  return '【本轮先查询已匹配资料】以下只是查询线索，不是释义或身份结论。先调用工具再使用；同名多义要结合当前语境辨别。\n'+matches.map(e=>`${tool}(key,token,q=${JSON.stringify(kind==='alias'&&subjects.has(String(e.qq))?String(e.qq):names(e,kind)[0])})`).join('\n');
}
export const queryEnabled=(cap,kind)=>cap?.isToolEnabled?.({term:'termQuery',alias:'aliasQuery',slang:'slangQuery'}[kind])!==false;
export const sourceGuidance=(kind,cap)=>!queryEnabled(cap,kind)?'资料查询工具当前关闭；未注入的资料不要猜测。':cap?.isToolEnabled?.('learningSources')===false?'默认只注入适用会话内的已确认资料；完整名称或QQ可按需查询。来源修改工具已关闭。':`默认只注入适用会话名单内的已确认资料。其他会话遇到完整名称${kind==='alias'?'或正在回复的QQ号':''}时先查询。反复用到且适合当前会话时，用 qq_knowledge_sources(key,token,kind="${kind}",id,action="include_here") 将当前会话加入名单；不再适用时用 exclude_here。来源调整不等于确认候选，也不改变原始采集证据。`;
export function promptInputs(payload={}) {
  const unread=payload.st?.unread||payload.state?.unread||[];
  return {key:payload.key,incomingText:payload.hasUnreadNow===false?'':payload.incomingText||'',userIds:unread.map(m=>m.userId||m.senderId||m.user_id||'').filter(Boolean)};
}

// Read-only observability uses the exact same eligibility and cap as default injection.
export function injectionReport(entries,kind,key,limit){
 const usable=entries.filter(e=>confirmed(e,kind)),eligible=usable.filter(e=>appliesHere(e,key)),selected=defaultEntries(entries,kind,key,limit);
 const count=entries.filter(e=>e.status==='confirmed').length;
 return {kind,key,total:entries.length,confirmed:count,unusable:count-usable.length,outOfScope:usable.length-eligible.length,eligible:eligible.length,limit:injectLimit(limit,0),selectedCount:selected.length,limited:eligible.length-selected.length,selected:selected.map(e=>semanticEntry(e,kind,key))};
}
