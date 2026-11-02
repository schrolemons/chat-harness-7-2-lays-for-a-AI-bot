import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {startConsoleFixture,projectRoot} from './console-ui-fixture.mjs';

const fixture=await startConsoleFixture();
const executablePath=[path.join(process.env.PROGRAMFILES||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'','Microsoft/Edge/Application/msedge.exe')].find(fs.existsSync);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===fixture.url?route.continue():route.abort());
 await page.goto(fixture.url+'/#layer-s');
 assert.match(await page.locator('#section-layer-s').innerText(),/先分批浏览 topic 目录/);
 assert.match(await page.locator('#section-layer-s').innerText(),/短卡完整读；长卡按章节展开/);
 assert.match(await page.locator('#section-layer-s').innerText(),/读取不等于永久记住/);
 assert.match(await page.locator('#section-layer-s').innerText(),/原文标题位置、本卡用途/);
 assert.match(await page.locator('#section-layer-s').innerText(),/不代表已读相邻卡全文/);
 assert.equal(await page.locator('#section-layer-s .core-reading-guide').count(),1,'reading rules need the same framed panel structure');
 const card=page.locator('.comp-card[data-id="personal-core"]');
 await card.locator('.comp-body').waitFor();
 await page.waitForFunction(()=>document.querySelector('.comp-card[data-id="personal-core"] .comp-body')?.dataset.loaded==='1');
 await card.getByText('按需阅读预算',{exact:true}).click();
 assert.match(await card.innerText(),/短卡整读／单页正文上限/);
 assert.equal(await card.locator('.parameter-scope').getAttribute('data-config-scope'),'本机配置');
 const originalDescription=fixture.componentFixtures.get('personal-core').description;
 fixture.componentFixtures.get('personal-core').description='目录刷新后的新规则';
 await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/plugins'),page.locator('#sLayerRefresh').click()]);
 await page.waitForFunction(()=>document.querySelector('.comp-card[data-id="personal-core"]')?.textContent.includes('目录刷新后的新规则'));
 fixture.componentFixtures.get('personal-core').description=originalDescription;
 await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/plugins'),page.locator('#sLayerRefresh').click()]);
 await page.waitForFunction(()=>document.querySelector('.comp-card[data-id="personal-core"] .comp-body')?.dataset.loaded==='1');
 const allText=await page.locator('#section-layer-s').textContent();
 assert.doesNotMatch(allText,/自动导读适用会话|目录默认分页条数|单次正文读取上限|例：例：/);
 assert.match(allText,/MCP.*单独|单独.*MCP/);
 const input=()=>card.locator('[data-config-key="libraryDir"] input');
 const save=async()=>{await card.locator('.comp-save').click();await page.waitForFunction(()=>document.querySelector('.comp-card[data-id="personal-core"] .comp-msg')?.textContent.includes('已重新读取'));};
 assert.match(await card.innerText(),/尚未挂载资料包/);
 const directory=path.join(projectRoot,'examples/personal-core/minimal');
 await input().fill(directory);await save();
 assert.equal(fixture.componentFixtures.get('personal-core').config.libraryDir,directory);
 assert.match(await card.locator('.core-mount-status').innerText(),/虚构/);
 assert.match(await card.locator('.core-mount-status').innerText(),/主题\s*2/);
 await input().fill(directory+'-missing');await card.locator('.comp-save').click();
 await page.waitForFunction(()=>document.querySelector('.comp-card[data-id="personal-core"] .comp-msg')?.textContent.includes('保存失败'));
 assert.equal(fixture.componentFixtures.get('personal-core').config.libraryDir,directory);
 await card.locator('[data-core-recheck]').click();
 await page.waitForFunction(()=>document.querySelector('.core-mount-message')?.textContent.includes('已重新校验'));
 assert.equal(await input().inputValue(),directory+'-missing','Recheck must preserve unsaved draft');
 fs.mkdirSync('state/audits/personal-core',{recursive:true});
 for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'S layer overflow at '+width);
 }
 await page.setViewportSize({width:1440,height:1000});await input().fill(directory);await save();
 await page.locator('#section-layer-s details').evaluateAll(rows=>rows.forEach(row=>row.open=true));
 const geometry=await page.locator('#section-layer-s .core-reading-guide,#sLayerRoot>.comp-card,#section-layer-s>.core-preparation-guide').evaluateAll(rows=>rows.map(el=>({width:el.getBoundingClientRect().width,radius:getComputedStyle(el).borderRadius,border:getComputedStyle(el).borderTopWidth})));
 assert.equal(geometry.length,3);assert.ok(Math.max(...geometry.map(x=>x.width))-Math.min(...geometry.map(x=>x.width))<2,'peer panels should share one width');assert.equal(new Set(geometry.map(x=>x.radius)).size,1,'panel corners should match');assert.ok(geometry.every(x=>x.border==='1px'));
 assert.ok((await page.locator('#section-layer-s details>summary').evaluateAll(rows=>rows.map(el=>getComputedStyle(el).listStyleType))).every(style=>style==='none'),'disclosures should not render both native and custom arrows');
 for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'expanded S layer overflow at '+width);
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.screenshot({path:'state/audits/personal-core/mount-desktop.png',fullPage:true});
 await page.screenshot({path:'state/audits/personal-core/mount-desktop-top.png'});
 await input().fill('');await save();assert.match(await card.innerText(),/尚未挂载资料包/);
 await card.locator('.comp-enabled').uncheck();await page.waitForFunction(()=>document.querySelector('.comp-card[data-id="personal-core"] .comp-save')?.disabled===true);
 await card.locator('.comp-enabled').check();await page.waitForFunction(()=>document.querySelector('.comp-card[data-id="personal-core"] .comp-save')?.disabled===false);
 assert.deepEqual(errors,[]);
 console.log('PASS generic S UI: mount, real validation failure, draft-safe recheck, unmount and 1440/768/390 layout');
}finally{await browser.close();await fixture.close();}
