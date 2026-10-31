import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/ctx-context-runtime/index.js';

function text(st,extra={}){
 const blocks=[];createPlugin({config:{},addPromptBlock:t=>blocks.push(t)}).hooks.beforePrompt({st,...extra});return blocks.join('\n');
}
test('time sense selects the newest human message across history and pending, rather than an old pending backlog',()=>{
 const now=Date.now(),out=text({unread:[{sender:'旧消息',time:now-9*3600000}],recentMessages:[{sender:'最新用户',time:now-1000},{sender:'bot',isSelf:true,time:now}]});
 assert.match(out,/最近一条来自「最新用户」/);assert.doesNotMatch(out,/最近一条来自「旧消息」/);
});
test('old context remains usable for an admitted proactive topic; age alone never orders a forced close',()=>{
 const out=text({unread:[],recentMessages:[{sender:'用户',text:'昨天报告没写完',time:Date.now()-24*3600000}]},{reason:'proactiveCheck',autonomousNow:true});
 assert.doesNotMatch(out,/默认不接|直接 qq_mark_read 收尾/);assert.match(out,/上一段/);assert.match(out,/不.*(?:自动|直接).*(?:结束|终止)/);
 assert.match(out,/缓存过期提醒/);assert.match(out,/不.*(?:当成|冒充).*刚/);
});
test('timestamp advice cannot discard genuine pending requests or forge completion',()=>{
 const out=text({unread:[{sender:'用户',time:Date.now()-9*3600000}]});
 assert.match(out,/待答/);assert.match(out,/不.*(?:完成|已回复)/);
});
test('private chat never inherits group participation advice to stay silent or leave room for others',()=>{
 const out=text({recentMessages:[{isSelf:true,time:Date.now()-1000},{sender:'用户',time:Date.now()-2000}]},{key:'private:1',isPrivate:true});
 assert.doesNotMatch(out,/参与度参考|群友|群里|撑场|潜水/);assert.match(out,/时间感/);
});
