// Final context policy only. Never changes another component or tool registration.
export const DEFAULT_POLICY=Object.freeze({enabled:true,order:[],disabled:[],compactHistory:true});
const protectedIds=new Set(['role-card','session-protocol','wake-action','delivery-rules','ctx-context-session','ctx-admin-dev','admin-boundary']);
const fixedIds=new Set(['role-card']);
const stableIds=new Set(['session-background','session-protocol','admin-boundary','relay-capability','delivery-rules','ctx-memory-profile-store']);
export function normalizePolicy(input={}) {
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('context 规则必须为对象');
 const out={...DEFAULT_POLICY,...input};
 for(const key of Object.keys(out))if(!Object.hasOwn(DEFAULT_POLICY,key))throw Error('未知 context 设置：'+key);
 for(const key of ['enabled','compactHistory'])if(typeof out[key]!=='boolean')throw Error(key+' 必须为开关');
 for(const key of ['order','disabled']) {
  if(!Array.isArray(out[key])||out[key].length>200||out[key].some(x=>typeof x!=='string'||!/^[a-z0-9][a-z0-9._:-]{0,99}$/i.test(x)))throw Error(key+' 包含无效模块');
  if(out[key].some(id=>id.startsWith('message-snapshot:')))throw Error('36号两部分关联启停，请使用message-snapshot父模块开关');
  if(new Set(out[key]).size!==out[key].length)throw Error(key+' 不允许重复模块');
 }
 return {...out,order:[...out.order],disabled:[...out.disabled]};
}
export function estimateTokens(text){return Math.ceil(String(text||'').length/2);}
export function compileModules(input,policy={},scene='message') {
 const rules=normalizePolicy(policy),disabled=new Set(rules.disabled),ranks=new Map(rules.order.map((id,i)=>[id,i]));
 const ids=new Set();
 const modules=input.map((row,index)=>{
  if(!row?.id||ids.has(row.id))throw Error('context 模块 ID 缺失或重复');ids.add(row.id);
  const text=String(row.text||'');
  const locked=protectedIds.has(row.id)||row.protected===true;
  // Only named administrator-owned sources can enter the system instruction layer.
  const placement=fixedIds.has(row.id)?'fixed':stableIds.has(row.id)?'stable':'current';
  const inactive=row.id==='tool-injection-lab'&&/^(timeBubble|careCheck|idleRescue|proactiveCheck|reminder|newsShare|scheduledContact)/.test(scene);
  const reason=!text.trim()?'本轮未产出':rules.enabled&&!locked&&disabled.has(row.id)?'O 层屏蔽':rules.enabled&&!locked&&inactive?'本场景无需演练':'';
  const chars=row.parts?.length?row.parts.reduce((n,part)=>n+String(part.text||'').length,0):Number.isSafeInteger(row.chars)&&row.chars>=0?row.chars:text.length;
  return {...row,text,index,protected:locked,placement,included:!reason,reason,chars,estimatedTokens:Math.ceil(chars/2)};
 });
 modules.sort((a,b)=>Number(b.placement==='fixed')-Number(a.placement==='fixed')
  ||(ranks.get(a.id)??(rules.order.length+a.index))-(ranks.get(b.id)??(rules.order.length+b.index)));
 const unique=new Map();
 for(const row of modules){if(!row.included)continue;const key=(row.placement==='fixed'?'system':'user')+'\n'+row.text.trim(),prior=unique.get(key);
  if(!prior){unique.set(key,row);continue;}
  const duplicate=row.protected&&!prior.protected?prior:row,kept=duplicate===prior?row:prior;
  duplicate.included=false;duplicate.reason='与 '+(kept.name||kept.id)+' 重复，已合并';unique.set(key,kept);
 }
 const selected=modules.filter(x=>x.included);
 return {modules,selected,beforeChars:modules.reduce((n,x)=>n+x.chars,0),afterChars:selected.reduce((n,x)=>n+x.chars,0)};
}
