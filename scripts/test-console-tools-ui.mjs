import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {startConsoleFixture} from './console-ui-fixture.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const executablePath=[path.join(process.env.PROGRAMFILES||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'','Microsoft/Edge/Application/msedge.exe')].find(fs.existsSync);
const fixture=await startConsoleFixture();fixture.state.v2.tools={status:false};
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
let releasePlugins,releaseConfig,releaseCatalog;const pluginsGate=new Promise(r=>releasePlugins=r),configGate=new Promise(r=>releaseConfig=r),catalogGate=new Promise(r=>releaseCatalog=r);let catalogRequests=0,failConfig=false;
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==fixture.url)return route.abort();if(url.pathname==='/api/plugins')await pluginsGate;if(url.pathname==='/api/socialV2/config'&&route.request().method()==='GET'){await configGate;if(failConfig)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'fixture unavailable'})});}if(url.pathname==='/api/tools/catalog'){catalogRequests++;await catalogGate;}await route.continue().catch(()=>{});});
 await page.goto(fixture.url+'/#v2-t',{waitUntil:'domcontentloaded'});
 assert.ok(await page.locator('#v2Tools .tool-parameter-group').count()>=5,'Tool groups must exist before plugin/config responses');
 assert.equal(await page.locator('#v2Tools [data-v2-tool]:enabled').count(),0,'Unknown settings must not be editable');
 assert.equal(await page.locator('#section-v2-t > .tool-switch-actions .v2-save').isDisabled(),true);
 releasePlugins();
 await page.waitForFunction(()=>document.querySelector('[data-component-id="tool-bilibili"] .comp-body')?.dataset.loaded==='1');
 assert.equal(catalogRequests,0,'Tool reference evidence must not block other component forms');
 assert.match(await page.locator('.tool-video-group > summary').innerText(),/bilibili 视频处理工具/);
 releaseConfig();await page.waitForFunction(()=>document.getElementById('v2Tools')?.dataset.loaded==='1');
 assert.equal(await page.locator('[data-v2-tool="status"]').isChecked(),false);assert.equal(await page.locator('[data-v2-tool="getPrompt"]').isChecked(),true);
 await page.locator('[data-tool-group="读取与状态"]').evaluate(e=>e.open=true);
 await page.locator('[data-v2-tool="status"]').check();await page.locator('#section-v2-t > .tool-switch-actions .v2-save').click();
 await page.waitForFunction(()=>document.querySelector('#section-v2-t .v2-save-msg')?.textContent.length>0);assert.match(await page.locator('#section-v2-t .v2-save-msg').innerText(),/已保存/);assert.equal(fixture.state.v2.tools.status,true);
 await page.locator('[data-v2-tool="status"]').uncheck();await page.locator('#section-v2-t .v2-save').click();await page.waitForFunction(()=>document.querySelector('#section-v2-t .v2-save-msg')?.classList.contains('ok'));assert.equal(fixture.state.v2.tools.status,false);
 await page.locator('[data-view="operations"]').first().click();const balance=page.locator('#balanceToolEnabled');assert.equal(await balance.count(),1);await balance.uncheck();await page.waitForFunction(()=>document.querySelector('#balanceToolControl [role=status]')?.textContent==='已停用');assert.equal(fixture.componentFixtures.get('tool-deepseek-balance').enabled,false);
 await page.locator('[data-view="v2-t"]').first().click();for(const width of [1440,768,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const boxes=await page.locator('.tool-parameter-group > summary').evaluateAll(es=>es.map(e=>({left:e.getBoundingClientRect().left,height:e.getBoundingClientRect().height})));assert.ok(boxes.every(b=>Math.abs(b.left-boxes[0].left)<1&&b.height>=48),JSON.stringify({width,boxes}));}
 await page.setViewportSize({width:1440,height:1000});assert.ok(await page.locator('.tool-parameter-group:not([open])').first().evaluate(e=>e.getBoundingClientRect().height<62));await page.screenshot({path:'state/audits/tools-ui-loading/fixture-tools.png'});
 await page.locator('[data-view="reference"]').first().click();await page.waitForFunction(()=>document.querySelector('#section-reference')?.hidden===false);await page.waitForTimeout(100);assert.equal(catalogRequests,1);releaseCatalog();await page.waitForFunction(()=>document.getElementById('toolReferenceRoot')?.textContent.includes('qq_status'));
 await page.locator('[data-view="v2-t"]').first().click();failConfig=true;await page.reload();await page.waitForFunction(()=>document.getElementById('toolSwitchRetry')?.hidden===false);await page.locator('[data-view="v2-t"]').first().click();assert.equal(await page.locator('#section-v2-t .v2-save').isDisabled(),true);assert.equal(await page.locator('#v2Tools [data-v2-tool]:enabled').count(),0);failConfig=false;await page.locator('#toolSwitchRetry').click();await page.waitForFunction(()=>document.getElementById('v2Tools')?.dataset.loaded==='1');
 assert.deepEqual(errors,[]);console.log('PASS immediate groups with delayed APIs; independent component forms; config read/save; balance toggle; lazy evidence; aligned layout at 1440/768/390');
}finally{releasePlugins();releaseConfig();releaseCatalog();await browser.close();await fixture.close();}
