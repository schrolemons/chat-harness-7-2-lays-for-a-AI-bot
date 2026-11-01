import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('./campus-watch.mjs',import.meta.url),'utf8');
for(const [kind,name]of [['bookmark','普通网站'],['blackboard','Blackboard']])test(name+' targeted retry updates health, clears recovery, and routes login failures to immediate notices',async()=>{
 const url=kind==='bookmark'?'https://site.example/course':'https://example.invalid/webapps/blackboard/content/listContent.jsp?course_id=c&content_id=p&mode=reset';
 const recovered=[],failed=[],notices=[],visited=[];let response={status:'ready',text:'课程资源',links:[],lines:['课程资源']};
 const sandbox={RETRY_URL:url,ROOT:'synthetic',CONFIG:{bbCourses:[{name:'合成课程',courseId:'c',pages:[{label:'资源',contentId:'p'},{label:'另一页',contentId:'other'}]}]},WATCH_SITES:[{name:'合成课程',url},{name:'另一站',url:'https://other.example/'}],siteSessions:{page:async target=>{visited.push(target);return {};}},skipLoginSite:()=>false,fetchPage:async()=>response,looksLoadFailed:()=>false,loginReady:async target=>recovered.push(target),loginFailed:async target=>failed.push(target),loginRecovery:{checkFailed:target=>notices.push(target)},flushLoginNotices:async()=>{},sha:s=>s,logLine:()=>{}};vm.createContext(sandbox);
 const start=source.indexOf('async function '+(kind==='bookmark'?'checkBookmarks':'checkBlackboard')+'('),end=source.indexOf(kind==='bookmark'?'async function notifyConv(':'const GRAB_DIR =',start);vm.runInContext(source.slice(start,end),sandbox);
 const run=kind==='bookmark'?sandbox.checkBookmarks:sandbox.checkBlackboard,state={};await run(null,state,[]);assert.deepEqual(visited,[url]);assert.deepEqual(recovered,[url]);assert.equal(state.monitorHealth[url].auth,'green');assert(state.monitorHealth[url].checkedAt>0);
 response={status:'login',text:''};await run(null,state,[]);assert.equal(failed[0].url,url);assert.equal(state.monitorHealth[url].auth,'red');assert.equal(recovered.length,1);
 response=null;await run(null,state,[]);assert.equal(notices[0].url,url);assert.equal(state.monitorHealth[url].fetch,'red');
});
