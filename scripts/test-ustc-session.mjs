import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareReportSession } from './ustc-session.mjs';

function browserFor(data) {
  const events=[];
  const page={
    waitForResponse(predicate) {
      assert.equal(predicate({url:()=>'/wxbgbgdz.do',status:()=>200,request:()=>({postData:()=>'*searchMeta=1'})}),false);
      return Promise.resolve({json:async()=>data});
    },
    async goto(url) {events.push(url);},
    browserContext:()=>({cookies:async()=>[{name:'_WEU',value:'app-session'}]}),
    async close(){events.push('closed');}
  };
  return {browser:{newPage:async()=>page},events};
}

test('initializes report application before exporting its session',async()=>{
  const {browser,events}=browserFor({datas:{wxbgbgdz:{rows:[]}}});
  const cookies=await prepareReportSession(browser);
  assert.ok(events.some(e=>e.includes('/xsbgglappustc/')));
  assert.equal(events.at(-1),'closed');
  assert.equal(cookies[0].value,'app-session');
});

test('invalid report response does not export an apparently successful login',async()=>{
  const {browser,events}=browserFor({code:'403'});
  await assert.rejects(prepareReportSession(browser),/报告/);
  assert.equal(events.at(-1),'closed');
});
