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
  let renameAttempts=0;
  api.sessions.rename=async()=>{renameAttempts++;throw Error('unavailable');};
  await assert.rejects(createTitledSession(api,create,{title:'任务 · 命名失败'}),/空会话已归档/);
  assert.equal(renameAttempts,1,'an explicit naming failure is reported after one rename attempt');
  assert.equal(log.at(-1)[0],'archive');
});

test('generic creates leave purpose naming to the native service without a redundant rename',async()=>{
  for(const title of [undefined,'','  ','Untitled','New Chat','未命名']){
    const client=new NodeApiClient('http://127.0.0.1:1',1000,{}),calls=[];
    client.callUnary=async(method,data)=>{calls.push({method,data});return {result:{ok:true,value:{sessionId:'session-generic-fixture'}}};};
    await client.sessions.create({agentPreset:'campus-summary',...(title===undefined?{}:{title})});
    assert.deepEqual(calls.map(call=>call.method),['session.create'],'generic title '+String(title));
    assert.equal('title' in calls[0].data,false,'local naming input must not leak into the DSH create request');
  }
});

test('idempotent adoption preserves existing titles and never invokes rename or archive',async()=>{
  for(const title of [undefined,'用户请求的另一标题']){
    const calls=[],response={result:{ok:true,value:{sessionId:'session-adopt-fixture'}}};
    const api={sessions:{rename:async()=>{calls.push('rename');throw Error('must not rename adopted sessions');}},workspace:{archiveSession:async()=>{calls.push('archive');}}};
    const create=async data=>{assert.equal(data.sessionId,'session-adopt-fixture');assert.equal('title' in data,false);return response;};
    assert.equal(await createTitledSession(api,create,{sessionId:'session-adopt-fixture',...(title===undefined?{}:{title})}),response);
    assert.deepEqual(calls,[]);
  }
});

function nativeTitleFixture(headerPreset,selectedPresets=[]){
  const hooks={};
  const session={id:'session-header-fixture',header:{cwd:'C:/native',agentPreset:headerPreset},events:selectedPresets.map(agentPreset=>({type:'agent-preset/selected',data:{agentPreset}}))};
  const ctx={sessionTitle:{get:s=>s.title,rename(s,title){const eventSeq=s.events.length;s.events.push({type:'session/title',data:{title,messageSeqs:[],source:{kind:'user'}}});return s.title={title,messageSeqs:[],source:{kind:'user'},eventSeq};}},on:(event,fn)=>{hooks[event]=fn;}};
  apply(ctx);hooks['session/created'](session);return session;
}

test('native purpose naming accepts the initial preset from the current session header',()=>{
  const session=nativeTitleFixture('qq-learning');
  assert.match(session.title?.title||'',/知识与黑话学习/);
  assert.equal(session.title.source.kind,'user');assert.deepEqual(session.title.messageSeqs,[]);
});

test('the final selected preset overrides the initial header preset',()=>{
  const session=nativeTitleFixture('qq-learning',['qq-chat','qq-task-worker']);
  assert.match(session.title?.title||'',/独立任务/);assert.doesNotMatch(session.title.title,/知识与黑话学习/);
});

test('an explicitly empty preset selection never falls back to a managed header preset',()=>{
  for(const selected of ['',null,undefined]){
    const session=nativeTitleFixture('qq-learning',['qq-task-worker',selected]);
    assert.equal(session.title,undefined,'a selected empty preset must supersede the header');
  }
});
test('native fallback handles internal sessions and preserves user titles and ordinary native chat',()=>{
  const hooks={},renamed=[];
  const ctx={sessionTitle:{get:s=>s.title,rename(s,title){renamed.push(s.id);return s.append('session/title',{title,messageSeqs:[],source:{kind:'user'}});}},on:(event,fn)=>{hooks[event]=fn;}};apply(ctx);
  function session(preset,title){const s={id:'session-fixture',events:preset?[{type:'agent-preset/selected',data:{agentPreset:preset}}]:[],header:{cwd:'C:/native'},title};s.append=(type,data)=>{const eventSeq=s.events.length;s.events.push({type,data});return s.title={...data,eventSeq};};return s;}
  const s=session('qq-learning');const savedEvents=s.events;delete s.events;s.snapshotEvents=()=>savedEvents;s.append=(type,data)=>{const eventSeq=savedEvents.length;savedEvents.push({type,data});return s.title={...data,eventSeq};};hooks['session/created'](s);assert.match(s.title.title,/知识与黑话学习/);
  assert.deepEqual(s.title.messageSeqs,[]);assert.equal(s.title.source.kind,'user');assert.equal(renamed.length,1);
  savedEvents.push({type:'agent-preset/selected',data:{agentPreset:'qq-task-worker'}});hooks['session/event'](s,{type:'agent-preset/selected'});assert.match(s.title.title,/独立任务/);
  s.append('session/title',{title:'人工名称',messageSeqs:[],source:{kind:'user'}});hooks['session/event'](s,{type:'agent-preset/selected'});assert.equal(s.title.title,'人工名称');
  const native=session();hooks['session/created'](native);assert.equal(native.title,undefined);
  const unrelated=session('qq-unrelated');const originalEvents=[...unrelated.events];hooks['session/created'](unrelated);assert.equal(unrelated.title,undefined);assert.deepEqual(unrelated.events,originalEvents);
  const provider=session('qq-learning',{title:'提供者名称',source:{kind:'provider'},eventSeq:42});hooks['session/created'](provider);assert.equal(provider.title.title,'提供者名称');
  for(const kind of ['user','provider'])for(const title of ['Untitled','New Chat','未命名']){
    const explicit=session('qq-learning',{title,source:{kind},eventSeq:43});hooks['session/created'](explicit);assert.equal(explicit.title.title,title);
    s.append('session/title',{title,messageSeqs:[],source:{kind}});hooks['session/event'](s,{type:'agent-preset/selected'});assert.equal(s.title.title,title);
  }
});
