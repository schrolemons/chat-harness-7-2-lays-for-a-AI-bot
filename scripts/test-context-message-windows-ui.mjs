import test from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';import fs from'node:fs';import path from'node:path';import{startConsoleFixture}from'./console-ui-fixture.mjs';
const {chromium}=createRequire(import.meta.url)('playwright'),executablePath=[path.join(process.env.PROGRAMFILES||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'','Microsoft/Edge/Application/msedge.exe')].find(fs.existsSync);
const call=(id,name)=>({role:'assistant',toolCalls:[{id,name}],text:JSON.stringify({type:'tool-call',id,name,arguments:{key:'group:12'}})}),result=(id,data)=>({role:'tool',toolResults:[{toolCallId:id}],text:JSON.stringify(data)});
test('history and pending tabs expose legacy and tool-returned human messages with true QQ receipt seqs',async()=>{
 const fixture=await startConsoleFixture(),browser=await chromium.launch({headless:true,executablePath});try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/context/preview*',async route=>{const response=await route.fetch(),data=await response.json();if(data.request){const r={...data.request,key:'group:12',messages:[
   {role:'system',text:'固定规则'},
   {role:'user',source:'qq-context-dialogue',provenance:{eventSeq:9800},text:'【历史 QQ 消息数据】\n'+JSON.stringify([{seq:535,dialogueSeq:2,sender:'用户甲',text:'应该出现在历史窗口的用户原文',receiptState:'complete'},{isSelf:true,dialogueSeq:3,sender:'我',text:'AI助手以前的回复'}])},
   call('u','qq_get_unread_messages'),result('u',[{seq:536,sender:'用户乙',text:'读取工具里的待处理用户原文'}]),
   call('w','qq_wait_for_messages'),result('w',{content:[{type:'text',text:JSON.stringify({ok:true,arrived:true,newMessages:[{seq:537,receiptState:'seen',sender:'用户丙',text:'等待工具里的待处理用户原文'}]})}]}),
   call('d','qq_get_message_detail'),result('d',{ok:true,key:'group:12',info:{seq:538,sender:'用户丁',text:'详情工具里的已处理用户原文',receiptState:'complete'}}),
   {role:'user',source:'qq-context-task',text:'请处理本次来信'},
   {role:'user',source:'qq-context-latest',text:'当前状态'},
  ]};data.request=r;data.requestStages=[{kind:'current',request:r}];}await route.fulfill({response,json:data});});
  await page.goto(fixture.url+'/#context-visual');await page.locator('#contextInspector').waitFor();
  for(const width of[1440,390]){
   await page.setViewportSize({width,height:1100});await page.locator('[data-inspector-region="history"]').click();
   assert.match(await page.locator('.context-sequence').innerText(),/应该出现在历史窗口的用户原文/);assert.match(await page.locator('.context-sequence').innerText(),/详情工具里的已处理用户原文/);
   assert.equal(await page.locator('[data-inspector-select="qq:535"] [data-qq-seq="535"]').innerText(),'535');assert(await page.locator('[data-qq-seq="535"]').evaluate(n=>parseFloat(getComputedStyle(n).fontSize)>=16));
   assert.equal(await page.locator('.context-sequence-number[data-qq-seq="2"],.context-sequence-number[data-qq-seq="3"],.context-sequence-number[data-qq-seq="9800"]').count(),0);
   await page.locator('[data-inspector-region="arrivals"]').click();assert.deepEqual(await page.locator('[data-entry-kind="qq"] .context-sequence-number').allTextContents(),['536','537']);
   assert.match(await page.locator('.context-sequence').innerText(),/读取工具里的待处理用户原文/);assert.match(await page.locator('.context-sequence').innerText(),/等待工具里的待处理用户原文/);
   await page.locator('[data-inspector-select="qq:536"]').click();await page.locator('.context-processing-record details>summary').click();await page.locator('.context-processing-record [data-inspector-message]').click();assert.equal(await page.locator('[data-inspector-layout="business"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.context-detail').getAttribute('data-inspector-detail'),'qq:536');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  const arg=process.argv.find(x=>x.startsWith('--artifacts='));if(arg){const dir=path.resolve(arg.slice(12));fs.mkdirSync(dir,{recursive:true});await page.setViewportSize({width:1440,height:1100});for(const region of['history','arrivals']){await page.locator('[data-inspector-region="'+region+'"]').click();await page.locator('#contextInspector').screenshot({path:path.join(dir,region+'-human-messages.png')});}}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await fixture.close();}
});
