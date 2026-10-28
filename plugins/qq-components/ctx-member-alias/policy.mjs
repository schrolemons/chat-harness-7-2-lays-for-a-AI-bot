import {createHash} from 'node:crypto';
export const validQq=v=>/^\d{5,12}$/.test(String(v||''));
const GENERIC=new Set(['我','你','他','她','它','大家','别人','对方','本人','管理员','群主','成员','用户','私聊','群聊','一下','问问']);
export const cleanName=v=>String(v??'').normalize('NFKC').trim().replace(/^[@“"「『【]+|[”"」』】]+$/g,'').trim().slice(0,50);
export const validAlias=v=>!!cleanName(v)&&!GENERIC.has(cleanName(v))&&!/^\d{5,12}$/.test(cleanName(v))&&!/[<>\r\n]/.test(cleanName(v));
export const aliasId=(a,q,k='')=>'a-'+createHash('sha256').update(cleanName(a).toLowerCase()+'\0'+String(q||'')+'\0'+(q?'':k)).digest('hex').slice(0,20);
export function extractSelfAlias(text){
  const s=String(text||'').trim();if(/不要|别叫|不许|不叫|他说|她说|有人说|引用|[?？]/.test(s))return '';
  const m=s.match(/^(?:(?:大家|以后|今后|你们?|都|可以)\s*)*(?:叫我|我的?(?:绰号|昵称|网名)是)\s*[“"「『]?([^，。！？!?；;、\s”"」』]{1,20})/);
  return validAlias(m?.[1])?cleanName(m[1]):'';
}
export function extractAliasClaims(text){
  const s=String(text||'').trim(),out=[];
  if(!s||s.startsWith('/'))return out;
  const self=extractSelfAlias(s);if(self)return [{alias:self,self:true,reason:'明确自称'}];
  if(/不是|不要叫|别叫|不许|不叫|是不是|也许|好像/.test(s))return out;
  let m=s.match(/^[“"「『]?([^，。！？!?；;\n]{1,30}?)[”"」』]?是[“"「『]?([^，。！？!?；;\n]{1,40}?)[”"」』]?的(?:绰号|外号|昵称|别称|别名)(?:[。！!，,]|$)/);
  if(m)out.push({alias:cleanName(m[1]),targetName:cleanName(m[2]),reason:'明确第三方绰号陈述'});
  m=s.match(/^@?([^，。！？!?；;\n]{1,40}?)的(?:绰号|外号|昵称|别名)(?:是|叫|为)[:：]?\s*([^，。！？!?；;\n]{1,30})/);
  if(m)out.push({alias:cleanName(m[2]),targetName:cleanName(m[1]),reason:'明确第三方绰号陈述'});
  m=s.match(/^@?([^，。！？!?；;\n]{1,30}?)(?:也叫|又叫|外号叫|绰号叫)\s*([^，。！？!?；;\n]{1,30})/);
  if(m)out.push({alias:cleanName(m[2]),targetName:cleanName(m[1]),reason:'明确第三方称呼'});
  // Conservative review-only cues: invitations, explicit ask-about phrasing,
  // and a short name following a platform mention. Never infer a QQ here.
  if(!out.length){
    m=s.match(/^([^，。！？!?；;\s]{2,12}?)(?:怎么还不来|还不来|又不来).*/);
    if(m)out.push({alias:cleanName(m[1]),reason:'邀约中的疑似称呼，待管理员判断'});
    m=s.match(/(?:去问问|问问|问一下|找找|去找)\s*([^，。！？!?；;\s]{2,12})$/);
    if(m)out.push({alias:cleanName(m[1]),reason:'询问对象中的疑似称呼，待管理员判断'});
    m=s.match(/^@?[【\[]([^】\]]{2,30})[】\]]\s*([^，。！？!?；;\s（）()]{2,12})(?:（[^）]*）|\([^)]*\))?$/);
    if(m)out.push({alias:cleanName(m[2]),targetName:cleanName(m[1]),reason:'平台昵称后的疑似称呼，待管理员判断'});
  }
  return out.filter(x=>validAlias(x.alias));
}

// Learning only accepts short, name-like strings. Contextual requests and
// arbitrary text after an @ mention are not evidence that a phrase is a name.
export function validNicknameCandidate(value){
  const name=cleanName(value);
  return validAlias(name)&&Array.from(name).length<=12&&!/[\s，。！？!?；;、,:：/\\]/u.test(name)
    &&!/^(?:我|你|他|她|它|我们|大家|怎么|为什么|去|问|找|模仿|告诉|请|是不是|别|不要)/u.test(name)
    &&!/(?:关于|获得|还不|什么|怎么|一下|的话|吗|呢|啊|吧|了)$/u.test(name);
}
