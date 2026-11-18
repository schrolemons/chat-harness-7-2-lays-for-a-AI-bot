const conversational=new Set(['proactiveCheck','timeBubble','startupGreeting','privateFollowup','careCheck','idleRescue']);
const independent=new Set(['reminder','milkStock','newsShare','scheduledContact','dailyDiary','worklog','notification','taskDone']);
const contactFor=state=>state.unansweredContact??(Number(state.lastProactiveAt)>Number(state.lastIncomingAt||0)?{firstAt:state.lastProactiveAt,attempts:1}:{});
export function observeUnanswered(state,{key,kind,at,directedAtBot,hasInteraction,isProactive,reason,duplicateEpisode}={}){
 const old=contactFor(state);
 if(kind==='incoming'&&(String(key).startsWith('private:')||directedAtBot===true||hasInteraction===true))return {firstAt:null,attempts:0,lastHumanAt:at};
 if(kind==='sent'&&!independent.has(reason)&&(isProactive===true||conversational.has(reason)))return {...old,firstAt:old.firstAt??at,attempts:(old.attempts||0)+(duplicateEpisode?0:1),lastSentAt:Math.max(old.lastSentAt||0,at)};
 return old;
}
export function unansweredBackoff(state,policy,now){
 const contact=contactFor(state),firstAt=contact.firstAt,floor=policy.minimumWillingness,base=Math.max(floor,state.willingness??policy.initialWillingness);
 const elapsed=Number.isFinite(firstAt)?Math.max(0,now-firstAt):0,after=policy.unansweredAfterMinutes*60000,step=policy.unansweredStepMinutes*60000;
 const steps=Number.isFinite(firstAt)&&elapsed>=after?1+Math.floor((elapsed-after)/step):0,penalty=steps*policy.unansweredPenalty,effective=Math.max(floor,base-penalty),attempts=contact.attempts||0;
 return {baseWillingness:base,willingness:effective,willingnessFactor:effective/base,unansweredPenalty:base-effective,unansweredSteps:steps,unansweredAttempts:attempts,unansweredSince:firstAt??null};
}
