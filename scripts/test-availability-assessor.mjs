import test from 'node:test';import assert from 'node:assert/strict';
import {createAvailabilityAssessor} from '../plugins/qq-components/life-wake-reasons/availability-assessor.mjs';
const key='private:123',now=Date.now(),text='今天考试结束啦，今晚有空聊一会儿',messages=[{seq:11,userId:'123',at:now,text}];
function fixture(){let data={lastIncomingAt:now,lastAI:{at:now-86400000,value:20}},resolve,quiet=false;const calls=[],jobs=new Map(),controller=new AbortController();
 const ctx={signal:controller.signal,scheduler:{schedule:j=>{jobs.set(j.id,j);return j;},cancel:id=>jobs.delete(id)},callService:(_,m,p)=>m==='inspect'?jobs.get(p.id):null,
  capabilities:{availabilityAssessmentContext:()=>quiet?null:{messages},runAvailabilityAssessment:p=>{calls.push(p);return new Promise(r=>resolve=r);}}};
 const assessor=createAvailabilityAssessor({ctx,get:()=>data,put:(_,s)=>data=s,baseline:60,apply:p=>{data={...data,willingness:p.value,lastAI:{at:p.now,value:p.value,reason:p.reason,assessment:p.assessment}};return {ok:true};}});
 return {a:assessor,ctx,calls,jobs,state:()=>data,resolve:r=>resolve(r),quiet:()=>quiet=true,abort:()=>controller.abort()};}
const answer=()=>({sessionId:'tool-free',text:JSON.stringify({value:80,kind:'available',reason:'本人今天明确说今晚有空',evidence:[{seq:11,quote:'今晚有空聊一会儿'}]})});
test('incoming queues a separate job without awaiting an LLM; delivery never moves semantic assessment into an active chat',async()=>{
 const f=fixture();assert.equal(f.a.request({key,now}),true);assert.equal(f.calls.length,0);const old=f.jobs.values().next().value.at;
 f.a.request({key,now:now+10000,afterDelivery:true});assert.equal(f.jobs.size,1);assert.equal(f.jobs.values().next().value.at,old);
 const run=f.a.run({key,now:now+120000});await Promise.resolve();assert.equal(f.calls.length,1);assert.equal(f.state().lastAI.value,20);
 assert.match(f.calls[0].prompt,/不发送消息|不发送/);assert.doesNotMatch(f.calls[0].prompt,/x-agent-token/);f.resolve(answer());await run;
 assert.equal(f.state().lastAI.value,80);assert.equal(f.state().lastAI.origin,'background');assert.equal(f.state().availabilityCheck.phase,'completed');assert.equal(f.a.request({key,now:now+20000}),false);
});
test('unverified evidence, cancellation, revoked access and newer assessment never overwrite state',async()=>{
 for(const mode of ['bad-evidence','abort','revoked','new-assessment','new-incoming']){const f=fixture(),run=f.a.run({key,now:now+120000});await Promise.resolve();const out=answer();
  if(mode==='bad-evidence'){const d=JSON.parse(out.text);d.evidence[0].quote='模型编造的原话';out.text=JSON.stringify(d);}
  if(mode==='abort')f.abort();if(mode==='revoked')f.quiet();if(mode==='new-assessment')f.state().lastAI={at:now+1000,value:90};if(mode==='new-incoming')f.state().lastIncomingAt=now+1000;
  f.resolve(out);await run;assert.equal(f.state().lastAI.value,mode==='new-assessment'?90:20,mode);
 }
});
test('new input during an active five-minute freshness window is queued for later instead of calling per message',()=>{
 const f=fixture();f.state().lastAI.at=now-60000;f.a.request({key,now});assert.equal(f.jobs.values().next().value.at,now+240000);assert.equal(f.calls.length,0);
});
