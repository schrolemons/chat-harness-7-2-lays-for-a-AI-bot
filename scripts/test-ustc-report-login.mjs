import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareReportSession} from './ustc-session.mjs';
import {openReportTableDOM} from './ustc-dom.mjs';

const loginUrl='https://example.invalid/gsapp/sys/yjsrzfwapp/dbLogin/main.do';
function fixture({login=false,status=200,rows=[],navigationError=false,text='学术报告选课'}={}){
 let closed=0,cookieReads=0,responseWaits=0;
 const request={url:()=> 'https://example.invalid/gsapp/sys/xsbgglappustc/modules/xsbgxk/wxbgbgdz.do',
  request:()=>({postData:()=>''}),status:()=>status,json:async()=>({datas:{wxbgbgdz:{rows}}})};
 const page={url:()=>login?loginUrl:'https://example.invalid/gsapp/sys/xsbgglappustc/*default/index.do',
  goto:async()=>{if(navigationError)throw Error('navigation timeout');},
  waitForResponse:(predicate)=>{responseWaits++;return login?Promise.reject(Error('response timeout')):
   predicate(request)?Promise.resolve(request):Promise.reject(Error('response predicate missed authentication failure'));},
  waitForFunction:async()=>{},evaluate:async(fn)=>login?{url:loginUrl,title:'登录',text:'请选择认证方式\n统一身份认证\n本地认证',password:false}:fn.toString().includes('jqxDataTable')?rows:{url:'https://example.invalid/gsapp/sys/xsbgglappustc/*default/index.do',title:'学术报告',text,password:false},
  browserContext:()=>({cookies:async()=>{cookieReads++;return [{name:'fixture',value:'fixture'}];}}),close:async()=>{closed++;}};
 return {browser:{newPage:async()=>page},get closed(){return closed;},get cookieReads(){return cookieReads;},get responseWaits(){return responseWaits;}};
}

for(const [name,open] of [['session',b=>prepareReportSession(b)],['DOM',b=>openReportTableDOM(b,{})]]){
 test(name+' identifies the authentication-choice page as auth failure before waiting for table data',async()=>{
  const f=fixture({login:true});await assert.rejects(open(f.browser),e=>e.error_type==='auth'&&/登录/.test(e.message));
  assert.equal(f.closed,1);assert.equal(f.cookieReads,0);
 });
 test(name+' preserves auth diagnosis when navigation itself timed out on the login page',async()=>{
  const f=fixture({login:true,navigationError:true});await assert.rejects(open(f.browser),e=>e.error_type==='auth');assert.equal(f.closed,1);
 });
}

test('session verifies response payload before exporting only the same context cookie jar',async()=>{
 const f=fixture();const cookies=await prepareReportSession(f.browser);assert.equal(cookies.length,1);assert.equal(f.cookieReads,1);assert.equal(f.closed,1);
});

test('HTTP 401 is reported as auth failure instead of hidden by the response filter',async()=>{
 const f=fixture({status:401});await assert.rejects(prepareReportSession(f.browser),e=>e.error_type==='auth');assert.equal(f.cookieReads,0);
});

test('valid report DOM still returns rows and leaves its page for the caller to close',async()=>{
 const rows=[{BGBM:'fixture',BGTMZW:'硅谷创新与AI进展'}],f=fixture({rows});
 const table=await openReportTableDOM(f.browser,{});assert.deepEqual(table.rows,rows);assert.equal(f.closed,0);await table.page.close();
});

test('course prose mentioning login does not turn a valid report table into an auth error',async()=>{
 const f=fixture({text:'学术报告选课\n如需查询历史记录，请登录教务平台查看。'});
 assert.equal((await prepareReportSession(f.browser)).length,1);
});
