import test from 'node:test';import assert from 'node:assert/strict';import {bridgeHarness} from './audit-bridge-harness.mjs';
test('real bridge route blocks a quoted image after raw reading and allows it after successful vision only',async t=>{
 const h=await bridgeHarness({config:{sendDelayMs:0},files:{'state/plugins/config/ctx-chat-reply-shape.json':{maxSendPerMinute:0,maxSendPerHour:0,intervalMinMs:0,intervalMaxMs:0,longGapProbability:0}}});
 let server; t.after(async()=>{if(server){server.closeAllConnections?.();await new Promise(r=>server.close(r));}await h.close();});
 h.setMode('reserved2');h.socialV2.paused=true;let reads=0;const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQmcAAAAASUVORK5CYII=','base64');
 h.bot.getImage=async()=>({data:bytes.toString('base64')});h.taskCaps.readImageWithModel=async()=>{reads++;return {text:JSON.stringify({observations:['图片1：测试像素'],uncertainties:[]})};};
 await h.handleIncoming('private',123,{message_id:101,user_id:123,self_id:999,sender:{nickname:'fixture'},message:[{type:'image',data:{file:'fixture.png'}}]},h.cfg);
 h.socialV2.paused=false;const key='private:123',st=h.getSocialV2State(key);st.bootstrapSent=true;const sid=await h.ensureSession(key);await h.deliverPrompt(key,'',{wakeReason:'private'});await h.queueDshEnvelope({payload:{type:'session/event',sessionId:sid,event:{type:'turn/start',data:{turn:1}}}});
 const id=h.activeTurnEnvelopes.get(sid).replyPlan.contentId;assert(id);assert.equal(reads,0);
 server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port,headers={'x-console-token':'fixture-console-token','x-agent-token':st.agentToken,'content-type':'application/json'};
 const get=async analyze=>{const r=await fetch(base+'/api/images/message?key='+key+'&messageId=101'+(analyze?'&analyze=1':''),{headers});return {status:r.status,body:await r.json()};};
 assert.equal((await get(false)).status,200);assert.equal(reads,0);
 const send=async()=>{const r=await fetch(base+'/api/socialV2/send-message',{method:'POST',headers:{...headers,'x-reply-content-id':id},body:JSON.stringify({key,replyToMessageId:'101',messages:'这个像素AI助手看清啦～'})});return {status:r.status,body:await r.json()};};
 const denied=await send();assert.match(JSON.stringify(denied.body),/image_reply_requires_analysis/);assert.equal(h.calls.http.filter(c=>/send_private_msg$/.test(c.url)).length,0);
 const analyzed=await get(true);assert.equal(analyzed.status,200,JSON.stringify(analyzed.body));assert.equal(reads,1);
 const sent=await send();assert.equal(sent.body.sent,1,JSON.stringify(sent.body));assert.equal(h.calls.http.filter(c=>/send_private_msg$/.test(c.url)).length,1);
});
