import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./campus-watch.mjs', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('const GRAB_DIR ='), source.indexOf('async function checkLecturesDOM('));
function runner(execFileSync, lectures = { enabled: true }) {
  const logs = [];
  const enrollments = [],beats=[],recoveries=[];
  const sandbox = {syncLectureCookies:()=>{},RETRY_URL:'',flushLoginNotices:async()=>{}, loginReady:async url=>recoveries.push(url), loginRecovery:{canCheck:()=>true,checkFailed:()=>{}}, reportScriptHeartbeat(...args){beats.push(args);}, MONITOR_SCRIPTS: new Set(["lectures", "grab"]), fs, path, ROOT: process.cwd(), process, execFileSync,
    CONFIG: { lectures }, logLine: s => logs.push(s),
    recordEnrollment: (_dir, item) => enrollments.push(item),
    migrateLegacyEnrollments: () => {},
    enrollmentChange: item => ({kind: 'enrolled', item}),
    checkLecturesDOM: async () => { logs.push('DOM fallback');return {ok:true}; } };
  vm.createContext(sandbox);
  vm.runInContext(section, sandbox);
  sandbox.refreshCookieJar=async()=>true;
  return { sandbox, logs, enrollments,beats,recoveries };
}

test('nonzero Python exit preserves its structured failure and partial successes', () => {
  const { sandbox } = runner((_exe, args) => {
    if (args[0].endsWith('sync_cookies.py')) return '';
    throw Object.assign(new Error('exit 1'), { stdout: '{"ok":false,"error":"HTTP 401","error_type":"auth","grabbed":[{"bgbm":"one"}]}' });
  });
  const result = sandbox.runGrabScript();
  assert.equal(result.error_type, 'auth');
  assert.equal(result.grabbed[0].bgbm, 'one');
});

test('failed cookie sync stops execution instead of silently using stale cookies', () => {
  const calls = [];
  const { sandbox } = runner((_exe, args) => { calls.push(args[0]); });
  sandbox.syncLectureCookies=()=>{throw new Error('cookie export missing');};
  const result = sandbox.runGrabScript();
  assert.equal(calls.length, 0);
  assert.equal(result.ok, false);
});

test('HTTP 401 falls back to DOM without claiming an empty successful check', async () => {
  const { sandbox, logs } = runner((_exe, args) => {
    if (args[0].endsWith('sync_cookies.py')) return '';
    throw Object.assign(new Error('exit 1'), { stdout: '{"ok":false,"error":"HTTP 401","error_type":"auth"}' });
  });
  const changes = [];
  await sandbox.checkLectures({}, {}, changes);
  assert.ok(logs.includes('DOM fallback'));
  assert.equal(changes.some(c=>c.kind==='login'),false);
  assert.ok(logs.some(s => s.includes('HTTP 401')));
  assert.ok(!logs.some(s => s.includes('抢课脚本已跑')));
});

test('successful script runs use UTF-8 and report enrollments', async () => {
  const { sandbox, enrollments } = runner((_exe, args, options) => {
    assert.equal(options.env.PYTHONUTF8, '1');
    if (args[0].endsWith('sync_cookies.py')) return '';
    return '{"ok":true,"grabbed":[{"bgbm":"one","title":"报告"}],"withdrawn":[]}';
  });
  const changes = [];
  await sandbox.checkLectures({}, {}, changes);
  assert.equal(changes[0]?.kind, 'enrolled');
  assert.equal(enrollments[0]?.bgbm, 'one');
});

test('scheduled checks respect a ten minute interval', async () => {
  let calls = 0;
  const { sandbox } = runner(() => { calls++; return '{"ok":true}'; }, {enabled: true, intervalMinutes: 10});
  await sandbox.checkLectures({}, {lastLectureCheckAt: Date.now() - 60000}, []);
  assert.equal(calls, 0);
});

test('failed application initialization never reuses an old cookie export for Python',async()=>{let calls=0;const {sandbox,logs,beats}=runner(()=>{calls++;return '{}';});sandbox.refreshCookieJar=async()=>false;await sandbox.checkLectures({}, {}, []);assert.equal(calls,0);assert.ok(logs.includes('DOM fallback'));assert.equal(beats.at(-1)[4],'fallback');});
test('capacity failures are not login failures',()=>{const {sandbox}=runner(()=>{}),changes=[];sandbox.handleGrabResult({failed:[{error:'full'}]}, {},changes);assert.equal(changes.some(c=>c.kind==='login'),false);});

test('recognized report authentication failure immediately requests its own login without Python or DOM retry',async()=>{
 let pythonCalls=0;const failures=[];
 const {sandbox,logs,beats}=runner(()=>{pythonCalls++;return '{}';},{enabled:true,portalUrl:'https://lecture.example/'});
 sandbox.refreshCookieJar=async()=>{throw Object.assign(Error('学术报告需要重新登录'),{error_type:'auth'});};
 sandbox.loginFailed=async(target,health)=>{failures.push(target.url);health.auth='red';};
 const state={};await sandbox.checkLectures({},state,[],true);
 assert.deepEqual(failures,['https://lecture.example/']);assert.equal(pythonCalls,0);assert.equal(logs.includes('DOM fallback'),false);
 assert.equal(state.monitorHealth['https://lecture.example/'].auth,'red');assert.equal(beats.at(-1)[2],false);
});

test('a successful lecture retry completes recovery and updates the visible website health',async()=>{
 const {sandbox,recoveries}=runner((_exe,args)=>args[0].endsWith('sync_cookies.py')?'':'{"ok":true,"grabbed":[],"withdrawn":[]}',{enabled:true,portalUrl:'https://lecture.example/',intervalMinutes:10});
 const state={};await sandbox.checkLectures({},state,[],true);
 assert.deepEqual(recoveries,['https://lecture.example/']);assert.equal(state.monitorHealth['https://lecture.example/'].auth,'green');assert.equal(state.monitorHealth['https://lecture.example/'].fetch,'green');assert(state.monitorHealth['https://lecture.example/'].checkedAt>0);
});
test('a successful DOM fallback also completes lecture recovery; a failed fallback does not',async()=>{
 const {sandbox,recoveries}=runner(()=>{throw Error('script unavailable');},{enabled:true,portalUrl:'https://lecture.example/'});
 const state={};await sandbox.checkLectures({},state,[],true);assert.deepEqual(recoveries,['https://lecture.example/']);assert.equal(state.monitorHealth['https://lecture.example/'].auth,'green');
 sandbox.checkLecturesDOM=async()=>undefined;await sandbox.checkLectures({},state,[],true);assert.equal(recoveries.length,1);assert.equal(state.monitorHealth['https://lecture.example/'].fetch,'red');
});

test('lecture DOM auth failures update the same website health and enter login recovery',async()=>{
 const {sandbox,recoveries}=runner(()=>{throw Error('script unavailable');},{enabled:true,portalUrl:'https://lecture.example/'}),failures=[];
 sandbox.loadCoursePolicy=()=>({query:{}});sandbox.openReportTableDOM=async()=>{throw Object.assign(Error('login required'),{error_type:'auth'});};
 sandbox.loginFailed=async(target,health)=>{health.auth='red';failures.push(target.url);};
 vm.runInContext(source.slice(source.indexOf('async function checkLecturesDOM('),source.indexOf('async function checkBookmarks(')),sandbox);
 const state={};await sandbox.checkLectures({browserContext:()=>({})},state,[],true);
 assert.deepEqual(failures,['https://lecture.example/']);assert.equal(recoveries.length,0);assert.equal(state.monitorHealth['https://lecture.example/'].auth,'red');
});
