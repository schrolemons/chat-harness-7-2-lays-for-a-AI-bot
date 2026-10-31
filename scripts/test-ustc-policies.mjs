import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCoursePolicy, recordEnrollment, processDOMRows, pendingEnrollments, acknowledgeEnrollments } from './ustc-course-policy.mjs';
import { selectReportDOM } from './ustc-dom.mjs';

const course={BGBM:'one',BGTMZW:'报告',DD:'高新校区',YXDM:'011',BGSJ:'2099-01-02 10:00',JZSJ:'2099-01-01 10:00',KXRS:100,YXRS:99,SFKXK:'1'};
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ustc-policy-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.mkdirSync(path.join(dir,'data'));
 fs.writeFileSync(path.join(dir,'config.yml'),'data_raw:\n  querySetting:\n    - name: YXDM\n      value: "011,023"\n  pageSize: 100\n  pageNumber: 1\n');
 fs.writeFileSync(path.join(dir,'data/exclude.json'),'{"EXCLUDE_BGBM":[]}');
 return dir;
}

test('DOM successful enrollment survives restart and cancellation without re-enrolling',async t=>{
 const dir=setup(t);let attempts=0;
 const enroll=async()=>{attempts++;return {ok:true}};
 await processDOMRows([course],loadCoursePolicy(dir,{locationKeyword:'高新'}),enroll);
 const next=await processDOMRows([course],loadCoursePolicy(dir,{locationKeyword:'高新'}),enroll);
 assert.equal(attempts,1);assert.equal(next.grabbed.length,0);
 assert.equal(pendingEnrollments(dir)[0].bgbm,'one');
});

test('full reports are retried when seats become available even after first discovery',async t=>{
 const dir=setup(t);let attempts=0;const enroll=async()=>{attempts++;return {ok:true}};
 await processDOMRows([{...course,YXRS:100}],loadCoursePolicy(dir,{locationKeyword:'高新'}),enroll);
 await processDOMRows([course],loadCoursePolicy(dir,{locationKeyword:'高新'}),enroll);
 assert.equal(attempts,1);
});

test('DOM applies the same exclusions, department, location and deadline constraints',async t=>{
 const dir=setup(t);
 fs.writeFileSync(path.join(dir,'data/exclude.json'),'{"EXCLUDE_BGBM":["excluded"]}');
 const rows=[{...course,BGBM:'excluded'},{...course,BGBM:'other-dept',YXDM:'999'},
  {...course,BGBM:'other-campus',DD:'西校区'},{...course,BGBM:'closed',JZSJ:'2020-01-01 10:00'},
  {...course,BGBM:'not-selectable',SFKXK:'0'}];
 let attempts=0;
 await processDOMRows(rows,loadCoursePolicy(dir,{locationKeyword:'高新'}),async()=>{attempts++;return {ok:true}});
 assert.equal(attempts,0);
});

test('failed DOM enrollment remains retryable and produces no success notification',async t=>{
 const dir=setup(t);let attempts=0;
 const enroll=async()=>({ok:++attempts>1});
 await processDOMRows([course],loadCoursePolicy(dir,{locationKeyword:'高新'}),enroll);
 assert.equal(pendingEnrollments(dir).length,0);
 await processDOMRows([course],loadCoursePolicy(dir,{locationKeyword:'高新'}),enroll);
 assert.equal(attempts,2);assert.equal(pendingEnrollments(dir).length,1);
});

test('success notifications stay pending until delivery is acknowledged',t=>{
 const dir=setup(t);recordEnrollment(dir,course);
 assert.equal(pendingEnrollments(dir).length,1);
 // No acknowledgement after a failed send, so the next process can retry.
 assert.equal(pendingEnrollments(dir).length,1);
 acknowledgeEnrollments(dir,['one']);assert.equal(pendingEnrollments(dir).length,0);
});

test('DOM never calls an ambiguous response a successful enrollment',async()=>{
 const page={waitForResponse:()=>Promise.resolve({status:()=>200,json:async()=>({})}),evaluate:async()=>true};
 assert.equal((await selectReportDOM(page,'one')).ok,false);
});

test('DOM accepts only the acknowledged enrollment result',async()=>{
 const page={waitForResponse:()=>Promise.resolve({status:()=>200,json:async()=>({code:'0',msg:'成功'})}),evaluate:async()=>true};
 assert.equal((await selectReportDOM(page,'one')).ok,true);
});
