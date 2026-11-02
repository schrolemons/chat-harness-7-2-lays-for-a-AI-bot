import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {bridgeHarness} from './audit-bridge-harness.mjs';

test('private/group read history survives reconnect, diary completion and bridge-state reload',async()=>{
 const now=Date.now(),keys=['private:123','group:456'];
 const conversations=Object.fromEntries(keys.map(key=>[key,{bootstrapSent:true,agentToken:key+'-token',lastUnreadSeq:1,lastReadThroughSeq:1,unread:[],recentMessages:[
  {seq:1,messageId:key+'-read',sender:'用户',userId:'123',text:'YESTERDAY_CHAT_STILL_RELEVANT',plain:'YESTERDAY_CHAT_STILL_RELEVANT',time:now-86400000,seenAt:now-86399000,repliedAt:now-86398000},
  {messageId:key+'-self',isSelf:true,sender:'bot',text:'PREVIOUS_BOT_REPLY',plain:'PREVIOUS_BOT_REPLY',time:now-86397000}
 ]}]));
 const config={socialV2:{dailyDiary:{hour:18,minute:30,enabled:false},proactive:{enabled:false}}};
 let h=await bridgeHarness({config,files:{'state/social-v2.json':{conversations}}});
 const verify=h=>{for(const key of keys){
  const st=h.getSocialV2State(key),read=st.recentMessages.find(m=>m.messageId===key+'-read');assert(read);assert(read.seenAt>0);assert(read.repliedAt>0);assert.equal(st.unread.length,0);
  const packet=h.buildWakeSnapshotV2(key);assert(packet.recent.some(m=>m.text==='YESTERDAY_CHAT_STILL_RELEVANT'));assert(packet.recent.some(m=>m.text==='PREVIOUS_BOT_REPLY'));
 }};
 try{
  h.setMode('reserved2');verify(h);await h.disconnectMux();verify(h);
  for(const key of keys){
   const before=Date.parse('2026-11-01T18:29:59+08:00'),after=before+2000;
   h.pluginHost.callService('memory','updateDiary',{key,day:'2026-11-01',now:before,text:'DIARY_BODY_ONLY'});
   const delivered=await h.pluginHost.callService('memory','sendDiaryDetailed',{key,day:'2026-11-01',now:after,purpose:'catchup',allowArchiveRetry:true});assert.equal(delivered.ok,true);
   assert.equal(h.pluginHost.callService('memory','diaryText',{key}),'');
  }
  verify(h);
  const saved=JSON.parse(fs.readFileSync(path.join(h.temp,'state/social-v2.json'),'utf8'));
  await h.close();h=null;
  h=await bridgeHarness({config,files:{'state/social-v2.json':saved}});h.setMode('reserved2');verify(h);
 }finally{await h?.close();}
});
