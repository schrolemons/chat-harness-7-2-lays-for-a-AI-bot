import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startConsoleFixture} from './console-ui-fixture.mjs';

const fixture=await startConsoleFixture();
const browser=await chromium.launch({headless:true,channel:'msedge'});
const errors=[];
let tools=[
  {name:'bili_analyze_video',qualifiedName:'mcp__snowluma__bili_analyze_video',description:'组合字幕和视频拼接图',server:'snowluma',audience:'qq',registered:true,botInjectedSessions:1},
  {name:'fixture_pending',qualifiedName:'mcp__fixture__fixture_pending',description:'待验证的工具',server:'fixture',audience:'qq',registered:true,botInjectedSessions:0},
  {name:'fixture_admin',qualifiedName:'mcp__fixture__fixture_admin',description:'管理工具',server:'fixture',audience:'admin',registered:true,botInjectedSessions:0},
];
try {
  const page=await browser.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/tools/catalog',route=>route.fulfill({json:{ok:true,stale:false,servers:[],tools}}));
  await page.goto(fixture.url);
  const search=page.locator('#consoleSearch');
  const results=page.locator('#searchResults');
  await search.fill('bili_analyze_video');
  await results.getByRole('button').filter({hasText:'bili_analyze_video'}).waitFor({timeout:5000});
  assert.notEqual(await page.locator('#section-reference').isVisible(),true,'search can load the catalog before visiting the tool page');
  await results.getByRole('button').filter({hasText:'bili_analyze_video'}).click();
  assert.equal(await page.locator('#section-reference').isVisible(),true);
  await page.locator('#toolReferenceRoot .tool-reference-item').first().waitFor();
  // The dropdown must remain clickable where it overlaps the page card,
  // including after page-entry animations have created stacking contexts.
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    await search.fill('wait');
    await results.getByRole('button').first().waitFor();
    await page.evaluate(()=>Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{}))));
    const exposed=await results.evaluate(el=>{
      const box=el.getBoundingClientRect(),card=document.querySelector('#section-reference').getBoundingClientRect();
      const x=Math.min(box.right-15,innerWidth-15),y=Math.max(box.top+20,card.top+20);
      return {overlaps:y<box.bottom&&y<innerHeight,unobstructed:el.contains(document.elementFromPoint(x,y))};
    });
    assert.equal(exposed.overlaps,true,'fixture dropdown overlaps the content card');
    assert.equal(exposed.unobstructed,true,'search suggestions must appear above the content card');
  }
  for(const query of ['BILI_ANALYZE_VIDEO','mcp__snowluma__bili_analyze_video','视频拼接图']) {
    await search.fill(query);
    assert.equal(await results.getByRole('button').filter({hasText:'bili_analyze_video'}).count(),1,query);
  }
  await search.fill('fixture_pending');
  await results.getByRole('button').filter({hasText:'fixture_pending'}).click();
  assert.equal(await page.locator('#toolPendingRoot').evaluate(el=>el.closest('details').open),true);
  await search.fill('fixture_admin');
  await results.getByRole('button').filter({hasText:'fixture_admin'}).click();
  assert.equal(await page.locator('#toolAdminRoot').evaluate(el=>el.closest('details').open),true);
  await search.fill('fresh_tool');
  tools=[{...tools[0],name:'fresh_tool',qualifiedName:'mcp__snowluma__fresh_tool'}];
  await page.locator('#toolsCatalogRefresh').click();
  await page.waitForFunction(()=>document.querySelector('#toolReferenceRoot').textContent.includes('fresh_tool'));
  await search.fill('fresh_tool');
  await results.getByRole('button').filter({hasText:'fresh_tool'}).waitFor();
  await search.fill('bili_analyze_video');
  assert.equal(await results.getByRole('button').count(),0,'removed tools leave the search index');
  await search.fill('唤醒');
  assert.ok(await results.getByRole('button').count()>0,'existing feature search remains available');
  await search.fill('');
  assert.equal(await results.isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('PASS tool-name, qualified-name, description, lazy load, navigation, collapsed sections, catalog refresh and feature search');
} finally {
  await browser.close();
  await fixture.close();
}
