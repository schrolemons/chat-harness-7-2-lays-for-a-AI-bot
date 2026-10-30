import test from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import fs from 'node:fs';import path from 'node:path';
import {startConsoleFixture} from './console-ui-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const exe=[path.join(process.env.PROGRAMFILES||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'','Microsoft/Edge/Application/msedge.exe')].find(x=>fs.existsSync(x));
test('context page selects captured session, masks independently, orders, saves globally and inspects actual request',async()=>{
 const fixture=await startConsoleFixture();const browser=await chromium.launch({headless:true,executablePath:exe});
 try{const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(fixture.url+'/#context-visual');await page.locator('#contextModules [data-context-id="ctx-context-dynamics"]').waitFor();
 assert.equal(await page.locator('#contextSession').inputValue(),'private:20012');
 const headings=await page.locator('#contextModules [data-context-group="modules"] .context-module h3').allTextContents();
 assert.deepEqual(headings.map(s=>Number(s.match(/^\d+/)?.[0])),Array.from({length:39},(_,i)=>i+1),'empty modules keep their original positions and visible numbering stays continuous');
 assert.ok((await page.locator('#contextModules [data-context-id="session-protocol"]').textContent()).includes('本轮暂无内容，位置保留'));
 assert.equal(await page.locator('#contextModules details[open]').count(),0);
 await page.locator('[data-context-toggle="ctx-context-dynamics"]').uncheck();await page.waitForFunction(()=>!document.querySelector('#contextSave').disabled);
 assert.ok((await page.locator('#contextModules [data-context-id="ctx-context-dynamics"]').getAttribute('class')).includes('is-excluded'));
 await page.getByRole('button',{name:'上移 黑话',exact:true}).click();await page.waitForFunction(()=>{const ids=[...document.querySelectorAll('#contextModules [data-context-id]')].map(x=>x.dataset.contextId);return ids.indexOf('slang-context')===36;});
 await page.locator('[data-context-id="ctx-context-dynamics"] .context-drag').dragTo(page.locator('[data-context-id="slang-context"] .context-drag'));
 await page.waitForFunction(()=>{const ids=[...document.querySelectorAll('#contextModules [data-context-id]')].map(x=>x.dataset.contextId);return ids.indexOf('ctx-context-dynamics')<ids.indexOf('slang-context');});
 await page.getByRole('button',{name:'保存所有会话的上下文设置',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#contextNotice').textContent.includes('已保存全局'));
 let reqs=await (await page.request.get(fixture.url+'/__fixture/requests')).json();
 assert.equal(reqs.requests.filter(x=>x.path==='/api/context/policy').length,1);assert.ok(!reqs.requests.some(x=>x.path==='/api/plugins/toggle'||x.path==='/api/plugins/order'));
 await page.reload();await page.locator('[data-context-toggle="ctx-context-dynamics"]').waitFor();assert.equal(await page.locator('[data-context-toggle="ctx-context-dynamics"]').isChecked(),false);
 await page.getByRole('button',{name:'本轮请求对比',exact:true}).click();assert.equal(await page.locator('#contextRequestSelect option').count(),3);assert.match(await page.locator('#contextRequestDiff').innerText(),/qq_schedule/);await page.locator('#contextRequestSelect').selectOption('initial');assert.match(await page.locator('#contextRequestDiff').innerText(),/本轮首次请求/);await page.locator('#contextRequestSelect').selectOption('current');await page.locator('[data-context-group="tools"]>summary').click();await page.locator('[data-context-id="actual-tools"]').waitFor();assert.equal(await page.locator('[data-context-group="modules"] .context-module').count(),39);assert.ok((await page.locator('#contextMetrics').textContent()).includes('2 个 / 360'));
 await page.locator('[data-context-id="actual-background"] summary').click();assert.equal(await page.locator('#contextModules literal-data').count(),0);
 for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no overflow at '+width);}
 const artifactArg=process.argv.find(x=>x.startsWith('--artifacts='));if(artifactArg){const dir=path.resolve(artifactArg.slice(12));fs.mkdirSync(dir,{recursive:true});await page.getByRole('button',{name:'设置效果预览',exact:true}).click();await page.screenshot({path:path.join(dir,'context-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:900});await page.screenshot({path:path.join(dir,'context-mobile.png'),fullPage:true});}
 assert.deepEqual(errors,[]);
 }finally{await browser.close();await fixture.close();}
});
