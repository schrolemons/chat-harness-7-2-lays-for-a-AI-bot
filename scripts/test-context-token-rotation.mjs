import test from 'node:test';
import assert from 'node:assert/strict';
import {contextParts,refillContext} from '../plugins/qq-components/obs-context-assembly/refill.mjs';

test('rotating credentials belong to current request state, while identity stays stable',()=>{
 const parts=contextParts({id:'ctx-context-session',text:'【当前角色】小鲸鱼\n\n【你的身份】QQ助手\n\n【会话令牌】new-test-token\n\n【此刻状态】未读6条'});
 assert.doesNotMatch(parts.stable,/会话令牌|new-test-token/);
 assert.match(parts.stable,/小鲸鱼/);assert.match(parts.current,/会话令牌.*new-test-token/);
});

test('resumed legacy prefix loses its stale token and latest snapshot carries only new token',()=>{
 let seq=1;const events=[{seq:1,type:'user/message',data:{id:'old-prefix',role:'user',source:{kind:'qq-context-stable',stableHash:'old'},content:[{type:'text',text:'【稳定会话资料】\n\n【会话令牌】old-test-token'}]}}],nodes=[1];
 const session={surface:{nodes},snapshotEvents:()=>events,eventAt:n=>events.find(e=>e.seq===n),append(type,data,intent){events.push({seq:++seq,type,data});const i=nodes.indexOf(intent.surfaceOp.startSeq);nodes.splice(i,1,seq);}};
 const selected=[{id:'ctx-context-session',placement:'current',text:'【你的身份】QQ助手\n\n【会话令牌】new-test-token\n\n【此刻状态】未读6条'}];
 const result=refillContext({session,compiled:{selected},key:'private:10001',nonce:'new-turn',position:{turn:2,step:0}});
 const prefix=session.eventAt(nodes[0]).data;
 assert.doesNotMatch(JSON.stringify(prefix),/old-test-token|new-test-token/);
 assert.match(result.messages.at(-1).content[0].text,/new-test-token/);
 assert.equal(events[0].data.content[0].text.includes('old-test-token'),true,'durable original must survive');
});
