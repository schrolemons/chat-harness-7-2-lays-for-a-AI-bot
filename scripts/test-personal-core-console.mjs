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
 const card=page.locator('.comp-card[data-id="personal-core"]');
 await card.locator('.comp-body').waitFor();
 await page.waitForFunction(()=>document.querySelector('.comp-card[data-id="personal-core"] .comp-body')?.dataset.loaded==='1');
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
 await page.setViewportSize({width:1440,height:1000});await input().fill(directory);
 await page.screenshot({path:'state/audits/personal-core/mount-desktop.png',fullPage:true});
 await input().fill('');await save();assert.match(await card.innerText(),/尚未挂载资料包/);
 await card.locator('.comp-enabled').uncheck();await page.waitForFunction(()=>document.querySelector('.comp-card[data-id="personal-core"] .comp-save')?.disabled===true);
 await card.locator('.comp-enabled').check();await page.waitForFunction(()=>document.querySelector('.comp-card[data-id="personal-core"] .comp-save')?.disabled===false);
 assert.deepEqual(errors,[]);
 console.log('PASS generic S UI: mount, real validation failure, draft-safe recheck, unmount and 1440/768/390 layout');
}finally{await browser.close();await fixture.close();}
