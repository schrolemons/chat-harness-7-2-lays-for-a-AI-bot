import test,{mock} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createIncidentNotebook} from '../plugins/qq-components/tool-user-checking/incidents.mjs';
import {createPlugin} from '../plugins/qq-components/tool-user-checking/index.js';
function fixture(append=()=>({ok:true})){let state={};const controller=new AbortController();const ctx={config:{maxNoteChars:500},signal:controller.signal,state:{get:()=>state,set:patch=>state={...state,...patch}},log:()=>{}};return {book:createIncidentNotebook(ctx,append),read:()=>state,controller};}
const issue={id:'incident-one',key:'group:456',phase:'open',at:100000,firstAt:90000,summary:'模型连续请求失败 HTTP400',impact:'群里只剩机械回执',nextStep:'检查请求日志和上下文编码'};
test('a failed desktop write never exposes the local home path through a group-callable tool',()=>{
 const stub=mock.method(fs,'appendFileSync',()=>{const e=new Error('EACCES: denied at '+os.homedir());e.code='EACCES';throw e;});
 try{let tool;createPlugin({config:{},log(){},registerTool:(_name,spec)=>tool=spec});const r=tool.handler({action:'note',text:'调用额度见底时想说的话'});assert.equal(r.ok,false);assert.match(r.error,/EACCES/);assert(!r.error.includes(os.homedir()));}finally{stub.mock.restore();}
});
test('one incident records open, stopped and recovery once each, without leaking secrets',()=>{
 const writes=[],f=fixture(text=>{writes.push(text);return {ok:true};});
 assert.equal(f.book.report(issue).ok,true);assert.equal(f.book.report(issue).duplicate,true);
 f.book.report({...issue,phase:'failed',summary:'token=abcdef123456 Bearer sk-abcdef123456 apiKey=secret-value'});
 f.book.report({...issue,phase:'resolved',summary:'模型链路已恢复；QQ投递以发送回执为准'});f.book.flush();
 assert.equal(writes.length,3);assert(writes[0].includes('首次发现'));assert(writes[0].includes('影响'));assert(writes[0].includes('排查'));assert(writes[2].includes('恢复'));
 assert(!JSON.stringify(f.read()).includes('abcdef123456'));assert(!writes.join('').includes('secret-value'));
});
test('file errors retain queued transitions; later successful flush appends them once',()=>{
 let fail=true;const writes=[];const f=fixture(text=>{if(fail)return {ok:false,error:'fixture disk unavailable'};writes.push(text);return {ok:true};});
 assert.equal(f.book.report(issue).ok,false);f.book.report({...issue,phase:'resolved'});assert.equal(writes.length,0);
 fail=false;f.book.flush();f.book.flush();assert.equal(writes.length,2);assert(writes[0].includes('待处理'));assert(writes[1].includes('恢复'));
});
test('aborted component cannot append and configured caps preserve complete characters',()=>{
 const writes=[],f=fixture(text=>{writes.push(text);return {ok:true};});f.controller.abort();assert.equal(f.book.report(issue).ok,false);f.book.flush();assert.equal(writes.length,0);
 const g=fixture(text=>{assert(text.length<=500);assert(text.isWellFormed());return {ok:true};});g.book.report({...issue,summary:'👩🏽‍💻'.repeat(200)});
});
test('existing whisper tool and automatic incident notes use the same append-only desktop file',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'whale-notes-'));fs.mkdirSync(path.join(home,'Desktop'));const stub=mock.method(os,'homedir',()=>home);
 try{let tool,state={};const blocks=[];const p=createPlugin({config:{noteFileName:'fixture.txt',maxNoteChars:500},signal:new AbortController().signal,state:{get:()=>state,set:patch=>state={...state,...patch}},log:()=>{},registerTool:(_name,spec)=>tool=spec,addPromptBlock:t=>blocks.push(t)});
  assert.equal(tool.handler({action:'note',text:'悄悄话原文'}).ok,true);assert.equal(p.services.desktopNotes.reportIssue(issue).ok,true);
  const text=fs.readFileSync(path.join(home,'Desktop/fixture.txt'),'utf8');assert(text.includes('悄悄话原文'));assert(text.includes('HTTP400'));assert.equal((text.match(/悄悄话原文/g)||[]).length,1);
  assert(p.hooks.beforePrompt().includes('限额'));assert(p.hooks.beforePrompt().includes('难缠'));assert(!JSON.stringify(tool.schema).includes(home));
 }finally{stub.mock.restore();fs.rmSync(home,{recursive:true,force:true});}
});
