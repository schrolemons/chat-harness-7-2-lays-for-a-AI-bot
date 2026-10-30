/** Verify every current manifest field independently of the form resolver. Fixture only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startConsoleFixture } from './console-ui-fixture.mjs';
import { COMPONENT_OWNERS,componentPage } from '../console/shared/components/ownership.js';

const {chromium}=createRequire(import.meta.url)('playwright');
const executablePath=[path.join(process.env.PROGRAMFILES||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'','Microsoft/Edge/Application/msedge.exe')].find(fs.existsSync);
const fixture=await startConsoleFixture();
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
const results=[],errors=[];
const customControls={
  'ctx-member-alias':{autoExtract:'aliasAutoExtract',autoSemantic:'aliasAutoSemantic',minMessages:'aliasMinMessages',cooldownMs:'aliasCooldown',maxCallsPerHour:'aliasMaxCalls'},
  'ctx-interest-terms':{autoExtract:'termsAutoExtract',autoResearch:'termsAutoResearch',minMessages:'termsMinMessages',cooldownMs:'termsCooldown',maxCallsPerHour:'termsMaxCalls',injectMax:'termsInjectMax'}
};
try{
  const page=await browser.newPage({viewport:{width:1440,height:1080}});
  page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+new URL(response.url()).pathname);});
  await page.route('**/*',route=>new URL(route.request().url()).origin===fixture.url?route.continue():route.abort());
  await page.goto(fixture.url);
  await page.waitForFunction(()=>document.getElementById('v2ContextRecentLimit')?.value==='100');
  const testedBuild=await page.locator('script[src^="/console/app.js"]').getAttribute('src');
  for(const [id,plugin] of fixture.componentFixtures){
    const checked=[],derived=[];
    if (['ctx-chat-style','ctx-context-dynamics','ctx-context-lifecycle','ctx-context-runtime','ctx-context-session'].includes(id) && plugin.configKeys.every(key=>key==='disabledBlocks')) {
      assert.equal(await page.locator('[data-component-id="'+id+'"],.comp-card[data-id="'+id+'"]').count(),0);
      results.push({id,checked:[],derived:plugin.configKeys.map(key=>({key,reason:'internal prompt assembly; registry only'})),ok:true});continue;
    }
    try{
      await page.locator(`[data-view="${componentPage(plugin)}"]`).first().click();
      const selector=COMPONENT_OWNERS[id]?.selector||`[data-component-id="${id}"],.comp-card[data-id="${id}"]`;
      const root=page.locator(selector).first();await root.waitFor({state:'attached'});
      const actualPage=await root.evaluate(el=>el.closest('[data-page]')?.dataset.page);
      if(actualPage)await page.locator(`[data-view="${actualPage}"]`).first().click();
      for(const ancestor of await root.locator('xpath=ancestor::details').all())if(await ancestor.getAttribute('open')===null)await ancestor.locator(':scope > summary').click();
      assert.equal(await root.isVisible(),true,`${id} must be visible`);
      const bodies=page.locator(`[data-component-id="${id}"] .comp-body,.comp-card[data-id="${id}"] .comp-body`);
      for(const body of await bodies.all())await page.waitForFunction(el=>el.dataset.loaded==='1',await body.elementHandle());
      for(const key of plugin.configKeys){
        if(/(?:api.?key|secret|token|password|credential)/i.test(key)){derived.push({key,reason:'secret uses separate credential storage'});continue;}
        if(['mcpProfileConfigured','watchUrlsConfigured','bbCoursesConfigured'].includes(key)){derived.push({key,reason:'internal provenance marker written by the owning form'});continue;}
        if(plugin.configSchema?.[key]?.editable===false||plugin.configSchema?.[key]?.readOnly===true){derived.push({key,reason:plugin.configSchema[key].description||'manifest declares read-only'});continue;}
        if(id==='ctx-chat-topic-drive'&&key==='sessionLimits'){
          const panel=page.locator('#v2FollowupSessionEditor');
          assert.equal(await panel.isVisible(),true);
          await page.locator('#v2FollowupSessionKey').selectOption('private:20012');
          await page.waitForFunction(()=>document.getElementById('v2TbFollowupMsg')?.textContent.includes('继承全局'));
          assert.equal(await page.locator('#v2TbFollowupInterval').inputValue(),'');assert.equal(await page.locator('#v2TbFollowupDaily').inputValue(),'');
          await page.locator('#v2TbFollowupInterval').fill('240');await page.locator('#v2TbFollowupDaily').fill('0');await page.locator('#v2TbFollowupSave').click();
          await page.waitForFunction(()=>document.getElementById('v2TbFollowupMsg')?.textContent.includes('已保存'));
          assert.deepEqual(plugin.config.sessionLimits,{'private:20012':{minIntervalMinutes:240,dailyLimit:0}},'specialized session editor must save the structured field');
          checked.push(key);continue;
        }
        const custom=customControls[id]?.[key];
        const fields=custom?page.locator('#'+custom):page.locator(`[data-component-id="${id}"] [data-config-key="${key}"],.comp-card[data-id="${id}"] [data-config-key="${key}"]`);
        assert(await fields.count(),`${id}.${key} has no editable control`);
        for(const field of await fields.all()){
          const state=await field.evaluate((el,key)=>{
            const input=el.matches('input,textarea,select')?el:el.querySelector('input,textarea,select');
            return {key,hasControl:!!input,disabled:input?.disabled,readOnly:input?.readOnly,type:input?.type,value:input?.value,checked:input?.checked,classes:input?.className,html:el.innerHTML};
          },key);
          assert(state.hasControl,`${id}.${key} has no input`);assert(!state.disabled&&!state.readOnly,`${id}.${key} cannot be edited`);
          const expected=plugin.config[key];
          if(typeof expected==='boolean')assert.equal(state.checked,expected,`${id}.${key} checkbox read`);
          else if(typeof expected==='number')assert.equal(Number(state.value),key==='cooldownMs'&&custom||state.classes?.includes('comp-form-minutes')?Math.round(expected/60000):expected,`${id}.${key} numeric read`);
          else if(typeof expected==='string')assert.equal(state.value,expected,`${id}.${key} text read`);
          else if(state.classes?.includes('comp-form-json'))assert.deepEqual(JSON.parse(state.value),expected,`${id}.${key} structured read`);
          else if(Array.isArray(expected)){
            if(state.html.includes('mood-rule-list')) {
              const actual=await field.locator('.mood-rule-row').evaluateAll(rows=>rows.map(row=>({id:row.dataset.ruleId,label:row.querySelector('.mood-rule-label').value,delta:Number(row.querySelector('.mood-rule-delta').value),description:row.querySelector('.mood-rule-description').value})));
              assert.deepEqual(actual,expected,`${id}.${key} structured rule table read`);
            }else if(state.classes?.includes('comp-form-lines'))assert.deepEqual(state.value.split('\n').filter(Boolean),expected,`${id}.${key} line-list read`);
            else if(state.classes?.includes('comp-form-text'))assert.deepEqual(state.value.split(/[,，]/).map(value=>value.trim()).filter(Boolean),expected,`${id}.${key} comma-list read`);
            else if(state.html.includes('comp-item-new')){
              const actual=await field.locator('.comp-item').evaluateAll(items=>items.map(item=>({value:item.querySelector('.comp-item-val').value,enabled:item.querySelector('.comp-item-on').checked})));
              assert.deepEqual(actual,expected.map(item=>typeof item==='string'?{value:item,enabled:true}:{value:item.value||'',enabled:item.enabled!==false}),`${id}.${key} editable items read`);
            }else assert.fail(`${id}.${key} has an unverified list editor`);
          }else if(expected&&typeof expected==='object'&&state.html.includes('comp-ack-enabled')){
            const actual=await field.evaluate(el=>({enabled:el.querySelector('.comp-ack-enabled').checked,delayMs:Number(el.querySelector('.comp-ack-delay').value)*1000,lines:el.querySelector('.comp-ack-lines').value.split('\n')}));
            assert.deepEqual(actual,expected,`${id}.${key} independent delay, switch and all message lines read`);
          }else assert.fail(`${id}.${key} has an unverified structured editor`);
        }
        checked.push(key);
      }
      assert(fixture.reads.some(read=>read.path==='/api/plugins/detail'&&new URLSearchParams(read.search).get('id')===id)||id==='ctx-interest-terms'&&fixture.requests.some(request=>request.body?.tool==='term_list')||plugin.configKeys.length===0,`${id} must load its config through its owning read API`);
      results.push({id,ok:true,checked,derived});console.log(`PASS ${id}: ${checked.length} editable fields, ${derived.length} declared internal/secret fields`);
    }catch(error){results.push({id,ok:false,checked,derived,error:error.message});console.error(`FAIL ${id}: ${error.message}`);}
  }
  const output=process.argv.slice(2).find(arg=>arg.startsWith('--output='))?.slice(9);
  if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({testedBuild,total:results.length,passed:results.filter(result=>result.ok).length,results,errors},null,2));}
  assert.deepEqual(errors,[]);assert.deepEqual(fixture.unknownRequests,[]);
  assert.equal(results.filter(result=>result.ok).length,fixture.componentFixtures.size,'All current component fields must be reachable and loaded');
}finally{await browser.close();await fixture.close();}
