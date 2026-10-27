import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {bridgeHarness} from './audit-bridge-harness.mjs';
test('notification batch never resends an existing item when batch composition changes',async()=>{
 const h=await bridgeHarness();try{h.setMode('reserved2');const now=Date.now(),item=(id,text)=>({id,text,sourceAt:now,expiresAt:now+3600000});await h.taskCaps.sendNotificationBatch('private:123',[item('report-one','FIRST')]);await h.taskCaps.sendNotificationBatch('private:123',[item('report-one','FIRST'),item('report-two','SECOND')]);assert.equal(h.calls.sent.filter(x=>x.text.includes('FIRST')).length,1);assert.equal(h.calls.sent.filter(x=>x.text.includes('SECOND')).length,1);}finally{await h.close();}
});
test('failed or uncertain QQ send is not marked sent and is not replayed automatically',async()=>{
 const h=await bridgeHarness();try{h.setMode('reserved2');let attempts=0;h.bot.sendPrivateMessage=async()=>{attempts++;throw Error('fixture transport timeout');};const now=Date.now(),item={id:'uncertain-report',text:'fixture',sourceAt:now,expiresAt:now+3600000};const result=await h.taskCaps.sendNotificationBatch('private:123',[item]);assert.equal(result.uncertain,true);await h.taskCaps.sendNotificationBatch('private:123',[item]);assert.equal(attempts,1);}finally{await h.close();}
});
test('manual and scheduled diary share receipts across plugin reload',async()=>{
 const h=await bridgeHarness();try{h.setMode('reserved2');const now=Date.now(),d=new Date(now),day=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),key='private:123',id='diary:'+key+':'+day;h.pluginHost.callService('memory','write',{key,text:'【日记】\nTODAY_DIARY'});assert.equal(h.taskCaps.deliveryStatus(id).status,'absent');const result=await h.pluginHost.callService('memory','sendDiaryDetailed',{key,now,day});assert.equal(result.ok,true);assert.equal(h.taskCaps.deliveryStatus(id).status,'sent');await h.pluginHost.reload('ctx-memory-store');const duplicate=await h.pluginHost.callService('memory','sendDiaryDetailed',{key,now,day});assert.equal(duplicate.reason,'already_sent');assert.equal(h.calls.sent.filter(x=>x.text.includes('TODAY_DIARY')).length,1);}finally{await h.close();}
});
test('each completed manual diary refresh can send the latest same-day summary with a unique receipt',async()=>{
 const h=await bridgeHarness();try{h.setMode('reserved2');const now=Date.now(),d=new Date(now),day=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),key='private:123';
  h.pluginHost.callService('memory','write',{key,text:'【日记】\nLATEST_MANUAL_DIARY'});
  const first=await h.pluginHost.callService('memory','sendDiaryDetailed',{key,now,day,allowArchiveRetry:true,manualRequestId:'manual-click-1'});
  h.pluginHost.callService('memory','write',{key,text:'【日记】\nLATEST_MANUAL_DIARY_V2'});
  const second=await h.pluginHost.callService('memory','sendDiaryDetailed',{key,now:now+1000,day,allowArchiveRetry:true,manualRequestId:'manual-click-2'});
  assert.equal(first.ok,true,JSON.stringify(first));
  assert.equal(second.ok,true,JSON.stringify(second));
  assert.notEqual(first.deliveryId,second.deliveryId);
  assert.equal(h.calls.sent.filter(x=>x.text.includes('LATEST_MANUAL_DIARY')).length,2);
  const archive=h.pluginHost.callService('memory','diaryArchiveRead',{date:day});
  assert.match(archive.text,/LATEST_MANUAL_DIARY_V2/);assert.doesNotMatch(archive.text,/LATEST_MANUAL_DIARY\n/);
  assert.equal(archive.text.split('## '+key+' ·').length-1,1,'同一天同一会话只保留最新的一份归档');
 }finally{await h.close();}
});
test('diary API requests a fresh memory turn before sending only today',async()=>{
 const h=await bridgeHarness({config:{socialV2:{dailyDiary:{hour:0,minute:0}}}});let server;try{
  h.setMode('reserved2');const now=Date.now(),d=new Date(now),day=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),key='private:123';
  h.getSocialV2State(key);h.pluginHost.callService('memory','write',{key,text:'【日记】\nAPI_DIARY_FIXTURE'});
  server=h.startConsoleServer();if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/api/socialV2/daily-diary?token=fixture-console-token';
  const post=async()=>{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'sendNow',key,day})});return {status:response.status,body:await response.json()};};
  const first=await post();assert.equal(first.status,200);assert.equal(first.body.pending,true);assert.equal(first.body.day,day);
  const firstRequestId=String(h.getSocialV2State(key).diaryRequestedId||'');assert.match(firstRequestId,/^[a-f0-9-]{36}$/);
  const get=await fetch(url,{method:'GET'}),status=await get.json(),conversation=status.conversations.find(c=>c.key===key);assert.equal(conversation.diaryPending,true);assert.equal(conversation.targetDate,day);
  const second=await post();assert.equal(second.status,409);assert.equal(second.body.reason,'pending');
  const firstSend=await h.pluginHost.callService('memory','sendDiaryDetailed',{key,now,day,allowArchiveRetry:true,manualRequestId:firstRequestId});assert.equal(firstSend.ok,true);
  const st=h.getSocialV2State(key);st.pendingMemoryWrite=false;st.diaryRequestedAt=0;st.diaryRequestedDay='';st.diaryRequestedId='';
  h.pluginHost.callService('memory','write',{key,text:'【日记】\nAPI_DIARY_FIXTURE_V2'});
  const third=await post();assert.equal(third.status,200);const nextRequestId=String(st.diaryRequestedId||'');assert.match(nextRequestId,/^[a-f0-9-]{36}$/);assert.notEqual(nextRequestId,firstRequestId);
  const secondSend=await h.pluginHost.callService('memory','sendDiaryDetailed',{key,now:now+1000,day,allowArchiveRetry:true,manualRequestId:nextRequestId});assert.equal(secondSend.ok,true);
  assert.equal(h.calls.sent.filter(x=>x.text.includes('API_DIARY_FIXTURE')).length,2);
 }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await h.close();}
});
test('diary archive-only state is visible and manual catch-up requires explicit action',async()=>{
 const h=await bridgeHarness({config:{socialV2:{dailyDiary:{hour:0,minute:0}}}});let server;try{
  h.setMode('reserved2');const now=Date.now(),d=new Date(now),day=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),key='private:123';
  h.getSocialV2State(key);const archive=path.join(h.temp,'state','memory','diary',day+'.md');fs.mkdirSync(path.dirname(archive),{recursive:true});fs.writeFileSync(archive,'# '+day+' 日记\n\n## '+key+' · 21:00\nARCHIVE_ONLY_DIARY\n');
  server=h.startConsoleServer();if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/api/socialV2/daily-diary?token=fixture-console-token';
  const get=await fetch(url),status=await get.json(),conversation=status.conversations.find(c=>c.key===key);assert.equal(conversation.deliveryStatus,'archive_only');assert.equal(conversation.targetSent,false);assert.equal(conversation.hasDiary,true);
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'catchUp',key,day})}),result=await response.json();assert.equal(result.sent,true);assert.equal(result.day,day);assert.equal(h.calls.sent.filter(x=>x.text.includes('ARCHIVE_ONLY_DIARY')).length,1);
 }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await h.close();}
});
test('catchUpAll sends each unsent retained date once and skips calendar gaps',async()=>{
 const h=await bridgeHarness();let server;try{
  h.setMode('reserved2');const now=Date.now(),key='private:123',days=[-3,-1].map(offset=>{const d=new Date(now+offset*86400000);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');});
  h.getSocialV2State(key);const dir=path.join(h.temp,'state','memory','diary');fs.mkdirSync(dir,{recursive:true});
  for(const [i,day] of days.entries())fs.writeFileSync(path.join(dir,day+'.md'),'# '+day+' 日记\n\n## '+key+' · 20:00\nCATCHUP_'+i+'\n');
  const already=await h.pluginHost.callService('memory','sendDiaryDetailed',{key,day:days[0],allowArchiveRetry:true});assert.equal(already.ok,true);
  server=h.startConsoleServer();if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/api/socialV2/daily-diary?token=fixture-console-token';
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'catchUpAll',key})}),result=await response.json();
  assert.equal(response.status,200);assert.deepEqual(result.results.map(x=>x.day),days);assert.equal(result.results[0].reason,'already_sent');assert.equal(result.results[1].ok,true);
  assert.equal(h.calls.sent.filter(x=>x.text.includes('CATCHUP_0')).length,1);assert.equal(h.calls.sent.filter(x=>x.text.includes('CATCHUP_1')).length,1);
 }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await h.close();}
});
test('uncertain diary send is reported and never sent again automatically',async()=>{
 const h=await bridgeHarness();try{h.setMode('reserved2');const now=Date.now(),d=new Date(now),day=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),key='private:123',id='diary:'+key+':'+day;h.pluginHost.callService('memory','write',{key,text:'【日记】\nUNCERTAIN_DIARY'});let attempts=0;h.bot.sendPrivateMessage=async()=>{attempts++;throw Error('fixture send timeout');};const first=await h.pluginHost.callService('memory','sendDiaryDetailed',{key,now,day});assert.equal(first.reason,'send_unconfirmed');assert.equal(h.taskCaps.deliveryStatus(id).status,'uncertain');const second=await h.pluginHost.callService('memory','sendDiaryDetailed',{key,now,day});assert.equal(second.reason,'delivery_unconfirmed');assert.equal(attempts,1);}finally{await h.close();}
});
test('quiet interval suppresses automatic notification and stale item never sends',async()=>{
 const h=await bridgeHarness();try{h.setMode('reserved2');const now=Date.now();h.pluginHost.callService('availability','setPlan',{key:'private:123',kind:'quiet',startISO:new Date(now-1000).toISOString(),endISO:new Date(now+3600000).toISOString(),reason:'开会'});const result=await h.taskCaps.sendNotificationBatch('private:123',[{id:'quiet',text:'DO_NOT_SEND',sourceAt:now,expiresAt:now+10000}]);assert.equal(result.reason,'quiet');h.pluginHost.callService('availability','cancelPlan',{key:'private:123'});await h.taskCaps.sendNotificationBatch('private:123',[{id:'stale',text:'DO_NOT_SEND',sourceAt:now-10000,expiresAt:now-1}]);assert.equal(h.calls.sent.length,0);}finally{await h.close();}
});
test('automatic notifications obey global pause and legacy muted state',async()=>{const h=await bridgeHarness();try{h.setMode('reserved2');const now=Date.now(),meta={id:'paused',sourceAt:now,expiresAt:now+10000};h.socialV2.paused=true;assert.equal(await h.taskCaps.sendNotification('private:123','DO_NOT_SEND',meta),false);h.socialV2.paused=false;h.getSocialV2State('private:123').mutedUntilReengaged={at:now};assert.equal(await h.taskCaps.sendNotification('private:123','DO_NOT_SEND',meta),false);assert.equal(h.calls.sent.length,0);}finally{await h.close();}});
test('notification expiring while queued is blocked at real outgoing boundary',async()=>{const h=await bridgeHarness();try{h.setMode('reserved2');let entered,release;const ready=new Promise(r=>entered=r);h.bot.sendPrivateMessage=async(_id,text)=>{if(text==='BLOCK'){entered();await new Promise(r=>release=r);}else h.calls.sent.push({text});};const first=h.sendToQQ('private:123','BLOCK');await ready;const now=Date.now(),pending=h.taskCaps.sendNotification('private:123','EXPIRED_QUEUED_NOTIFICATION',{id:'queued-expiry',sourceAt:now,expiresAt:now+20});await new Promise(r=>setTimeout(r,40));release();await first;assert.equal(await pending,false);assert.equal(h.calls.sent.length,0);}finally{await h.close();}});
