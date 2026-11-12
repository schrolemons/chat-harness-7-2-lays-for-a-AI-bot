import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {readPublicHttpSnapshot} from './web-watch-public-http.mjs';
const url='http://course.example/lesson';

test('HTTP fallback reads inert public HTML with no scripts, cookies, subresources or navigation',async()=>{
 const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const context=await browser.createBrowserContext(),page=await context.newPage();let fetched=0;
  const html='<title>课程</title><meta http-equiv="refresh" content="0;url=https://outside.invalid/"><script>globalThis.ran=true;fetch("https://outside.invalid/")</script><main><h1>课程资料</h1><p>本周作业：练习一</p><a href="notes.pdf">讲义</a><iframe src="https://outside.invalid/"></iframe></main>';
  const snapshot=await readPublicHttpSnapshot(page,url,{fetchImpl:async(target,options)=>{fetched++;assert.equal(target,url);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.headers.cookie,undefined);return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});}});
  assert.equal(fetched,1);assert.equal(snapshot.url,url);assert.match(snapshot.text,/本周作业/);assert.equal(snapshot.links[0].h,'notes.pdf');assert.equal(snapshot.password,false);assert.equal(snapshot.transport,'public-http');assert.equal((await context.pages()).length,1,'temporary parser closes');await page.close();
 }finally{await browser.close();}
});

test('fallback refuses HTTPS targets, embedded credentials, redirects, non-HTML and oversized responses',async()=>{
 const page={browserContext(){throw Error('must not render');}};
 for(const target of ['https://course.example/','http://user:pass@course.example/'])await assert.rejects(()=>readPublicHttpSnapshot(page,target),/public HTTP/);
 await assert.rejects(()=>readPublicHttpSnapshot(page,url,{fetchImpl:async()=>new Response('',{status:302,headers:{location:'https://other.example/'}})}),/HTTP 302/);
 await assert.rejects(()=>readPublicHttpSnapshot(page,url,{fetchImpl:async()=>new Response('pdf',{headers:{'content-type':'application/pdf'}})}),/HTML/);
 await assert.rejects(()=>readPublicHttpSnapshot(page,url,{fetchImpl:async()=>new Response('x'.repeat(2*1024*1024+1),{headers:{'content-type':'text/html'}})}),/too large/);
});

test('anonymous fallback requires an exact opt-in HTTP URL and never assumes saved authentication is reusable',async()=>{
 const {allowsAnonymousHttpFallback}=await import('./web-watch-public-http.mjs');const url='http://public.example/resource';
 assert.equal(allowsAnonymousHttpFallback(url,{}),false);
 assert.equal(allowsAnonymousHttpFallback(url,{anonymousHttpFallbackUrls:[url]}),true);
 assert.equal(allowsAnonymousHttpFallback(url+'/other',{anonymousHttpFallbackUrls:[url]}),false);
 assert.equal(allowsAnonymousHttpFallback('https://public.example/resource',{anonymousHttpFallbackUrls:['https://public.example/resource']}),false);
});
