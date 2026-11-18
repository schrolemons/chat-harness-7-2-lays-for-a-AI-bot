// This is an upstream rejection/backoff record, never a price or local bill.
const COOLDOWN=15*60000;
export function createUpstreamAvailability(ctx){
 const read=provider=>ctx.state.get().upstreamAvailability?.[provider];
 return {
  observeError({provider,error,at=Date.now()}={}){
   const text=typeof error==='string'?error:error?.message;
   if(typeof provider!=='string'||!provider||!Number.isFinite(at)||at<Date.now()-COOLDOWN||typeof text!=='string'||!/budget_exceeded|ExceededBudget:.*\bbudget\b|Insufficient Balance/i.test(text))return {recorded:false};
   const old=read(provider);if(old?.at>=at)return {recorded:false,duplicate:true};
   const spend=Number(text.match(/Spend=\$([\d.]+)/)?.[1]),limit=Number(text.match(/Limit=\$([\d.]+)/)?.[1]);
   const value={provider,reason:/Insufficient Balance/i.test(text)?'upstream_balance':'upstream_budget',at,retryAt:at+COOLDOWN,...(Number.isFinite(spend)?{spend}:{}),...(Number.isFinite(limit)?{limit}:{}),windowHours:/over 12h budget/i.test(text)?12:null};
   ctx.state.set({upstreamAvailability:{...ctx.state.get().upstreamAvailability,[provider]:value}});return {recorded:true,...value};
  },
  status({provider,now=Date.now()}={}){const value=read(provider);return {provider,blocked:!!value&&value.retryAt>now,...(value?{...value,reason:value.retryAt>now?value.reason:'retry_allowed'}:{})};}
 };
}
