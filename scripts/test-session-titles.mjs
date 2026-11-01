import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionTitle,createTitledSession} from '../src/session-titles.js';
import {apply} from '../plugins/qq-agent-presets/session-title-fallback.mjs';
import {NodeApiClient} from '../src/dsh-client.js';
test('real NodeApiClient create adapter names the returned session without an extra model call',async()=>{
  const client=new NodeApiClient('http://127.0.0.1:1',1000,{}),calls=[];
  client.callUnary=async(method,data)=>{calls.push({method,data});return {result:{ok:true,value:method==='session.create'?{sessionId:'session-test'}:{title:data.title,seq:1}}};};
  await client.sessions.create({agentPreset:'qq-learning',title:'后台学习'});
  assert.deepEqual(calls.map(c=>c.method),['session.create','session.rename']);
  assert.equal(calls[1].data.title,'后台学习');
});
test('purpose names distinguish tasks, learning, verification and QQ contacts',()=>{
  assert.match(sessionTitle({sessionId:'session-12345678',agentPreset:'qq-learning'}),/知识与黑话学习/);
  assert.match(sessionTitle({key:'group:123'}),/QQ 群聊 · 123/);
  assert.match(sessionTitle({cwd:'C:\\bot\\state\\audits\\voice-check',agentPreset:'qq-chat-v2'}),/验证 · voice-check/);
  assert.equal(sessionTitle({title:'用户原名'}),'用户原名');
});
test('client names before returning, removes local title argument, and archives when naming fails',async()=>{
  const log=[],success=value=>({result:{ok:true,value}});
  const api={sessions:{rename:async data=>{log.push(['rename',data]);return success({title:data.title});}},workspace:{archiveSession:async data=>{log.push(['archive',data]);return success({});}}};
  const create=async data=>{assert.equal('title' in data,false);return success({sessionId:'fixture-1'});};
  await createTitledSession(api,create,{agentPreset:'qq-task-worker',title:'任务 · 报表'});
  assert.equal(log[0][1].title,'任务 · 报表');
  api.sessions.rename=async()=>{throw Error('unavailable');};
  await assert.rejects(createTitledSession(api,create,{}),/空会话已归档/);
  assert.equal(log.at(-1)[0],'archive');
});
test('native fallback handles internal sessions and preserves user titles and ordinary native chat',()=>{
  const hooks={};const ctx={sessionTitle:{get:s=>s.title},on:(event,fn)=>{hooks[event]=fn;}};apply(ctx);
  function session(preset,title){const s={id:'session-fixture',events:preset?[{type:'agent-preset/selected',data:{agentPreset:preset}}]:[],header:{cwd:'C:/native'},title};s.append=(type,data)=>{s.events.push({type,data});s.title=data;};return s;}
  const s=session('qq-learning');const savedEvents=s.events;delete s.events;s.snapshotEvents=()=>savedEvents;s.append=(type,data)=>{savedEvents.push({type,data});s.title=data;};hooks['session/created'](s);assert.match(s.title.title,/知识与黑话学习/);
  s.title={title:'人工名称',source:{kind:'user'}};hooks['session/event'](s,{type:'agent-preset/selected'});assert.equal(s.title.title,'人工名称');
  const native=session();hooks['session/created'](native);assert.equal(native.title,undefined);
});
