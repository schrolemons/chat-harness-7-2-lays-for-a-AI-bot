// Transport window sizes only. Budget-stage selection remains with life-token-budget.
export const CONTEXT_LIMIT_FIELDS=Object.freeze({
 recentLimit:{default:100,min:1,max:1000},unreadLimit:{default:30,min:1,max:1000},contextWindow:{default:20,min:1,max:1000},
 wakeRecentLimit:{default:4,min:0,max:100},wakeMessageLimit:{default:12,min:1,max:100},
 wakeHistoryMessageMaxChars:{default:0,min:0,max:20000},wakePendingMessageMaxChars:{default:0,min:0,max:20000},
 wakeMaxChars:{default:6000,min:500,max:20000},weakWakeMaxChars:{default:1800,min:500,max:20000}
});
export function normalizeContextLimits(raw={}){return Object.fromEntries(Object.entries(CONTEXT_LIMIT_FIELDS).map(([key,rule])=>{const value=Number(raw[key]??rule.default);return[key,Number.isFinite(value)?Math.min(rule.max,Math.max(rule.min,Math.round(value))):rule.default];}));}
export function validateContextLimits(raw={}){for(const [key,rule]of Object.entries(CONTEXT_LIMIT_FIELDS)){if(raw[key]===undefined)continue;const value=Number(raw[key]);if(!Number.isSafeInteger(value)||value<rule.min||value>rule.max)return{ok:false,error:key+' 必须为 '+rule.min+'–'+rule.max+' 的整数'};}return{ok:true};}
export function contextMessageExcerpt(message,maxChars=0){
 if(!maxChars||!message||typeof message!=='object')return message;
 const fields=['text','plain','tail'].filter(key=>typeof message[key]==='string'),unique=[...new Set(fields.map(key=>message[key]))],body=Array.from(unique.join('\n'));
 if(body.length<=maxChars)return message;
 const count=Math.max(1,Math.floor(maxChars)),front=Math.ceil((count-1)*0.7),back=count-1-front,excerpt=body.slice(0,front).join('')+'…'+(back?body.slice(-back).join(''):'');
 const out={...message};for(const field of fields)delete out[field];out[fields.includes('plain')?'plain':'text']=excerpt;
 return {...out,truncated:true,originalChars:body.length,suppliedChars:count};
}
