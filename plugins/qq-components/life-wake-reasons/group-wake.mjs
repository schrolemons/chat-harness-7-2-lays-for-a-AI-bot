// Group arrivals share the proactive model's current p; this owner adds q once.
export const GROUP_WAKE_DEFAULTS=Object.freeze({groupAtBonus:.6,groupNameBonus:.4,groupQuestionBonus:.3,groupPokeBonus:.6,groupNames:''});
export const GROUP_WAKE_FIELDS=Object.freeze(Object.keys(GROUP_WAKE_DEFAULTS));
export function groupNames(value){return [...new Set(String(value||'').split(/[,，\n]/).map(s=>s.trim()).filter(Boolean))].slice(0,50);}
export function validateGroupWake(config={}){
 const errors=[];
 for(const key of GROUP_WAKE_FIELDS.filter(k=>k!=='groupNames'))if(config[key]!==undefined&&(typeof config[key]!=='number'||!Number.isFinite(config[key])||config[key]<0||config[key]>1))errors.push(key+' must be 0..1');
 if(config.groupNames!==undefined&&(typeof config.groupNames!=='string'||config.groupNames.length>5000))errors.push('groupNames must be a string of at most 5000 characters');
 return errors;
}
export function matchesGroupName(text,names){
 const lower=String(text||'').toLowerCase();
 return groupNames(names).some(name=>{const word=name.toLowerCase();return /^[a-z0-9]+$/.test(word)&&word.length<=4?new RegExp('\\b'+word+'\\b','i').test(lower):lower.includes(word);});
}
export function evaluateGroupIncoming({key,p=0,policy={},event={},random=Math.random}={}){
 if(String(key).startsWith('private:'))return {accepted:true,reason:'private',probability:1,baseProbability:1,extraProbability:0,matched:[]};
 const baseProbability=Math.max(0,Math.min(1,Number.isFinite(p)?p:0)),q={...GROUP_WAKE_DEFAULTS,...policy};
 const nameMention=matchesGroupName(event.text,q.groupNames);
 const text=String(event.text||'');
 const asks=/[?？吗呢]|怎么|为什么|哪|谁|能不能|会不会|是否|是不是|行不行/.test(text);
 const directedQuestion=event.question===true || (asks && (event.atMention || nameMention || /^(?:你|您).{0,10}(?:能|会|有|是|觉得|怎么|为什么|吗|呢|[?？])/.test(text.trim())));
 const matches=[['atMention',event.atMention,q.groupAtBonus],['nameMention',nameMention,q.groupNameBonus],['question',directedQuestion,q.groupQuestionBonus],['poke',event.poke&&event.targetIsSelf,q.groupPokeBonus]].filter(([,hit])=>hit);
 const strongest=matches.reduce((best,row)=>row[2]>best[2]?row:best,['probability',true,0]);
 const extraProbability=strongest[2],probability=Math.min(1,baseProbability+extraProbability);
 const accepted=probability>0&&(probability===1||random()<probability);
 return {accepted,reason:strongest[0],probability,baseProbability,extraProbability,matched:matches.map(([name])=>name)};
}
