import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {parse} from 'acorn';
// Execute the actual entrypoint function bodies with forbidden legacy effects.
// This never loads campus configuration, navigates a website or creates a browser.
async function functions(file,names,context){
 const source=await fs.readFile(new URL(file,import.meta.url),'utf8');const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 const code=ast.body.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name)).map(n=>source.slice(n.start,n.end)).join('\n');
 return vm.runInNewContext(code+'\n({'+names.join(',')+'})',context);
}
test('owned campus browser acquisition never discovers or closes a configured external browser',async()=>{
 const calls=[];const {ensureBrowser}=await functions('./campus-watch.mjs',['ensureBrowser'],{
  ownedMonitor:{connect:async headless=>{calls.push(headless);return 'owned-browser';}},
  launchBrowser:()=>assert.fail('legacy browser launch'),ensureSessionBrowser:()=>assert.fail('legacy discovery must not run'),puppeteer:{connect:()=>assert.fail('external connect')}
 });assert.equal(await ensureBrowser(),'owned-browser');assert.deepEqual(calls,[true]);
});
test('owned login launch and connect use runtime capability, never legacy configured port',async()=>{
 const calls=[];const {launch,connect}=await functions('./login-window.mjs',['launch','connect'],{
  ownedMonitor:{connect:async headless=>{calls.push(headless);return 'owned-browser';}},
  PORT:12345,PROFILE:'external-profile',puppeteer:{connect:()=>assert.fail('legacy port discovery')},fs:{mkdirSync:()=>assert.fail('legacy profile')}
 });assert.equal(await connect(),null);assert.equal(await launch(false),'owned-browser');assert.deepEqual(calls,[false]);
});
