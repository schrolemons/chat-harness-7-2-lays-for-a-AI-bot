import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createViewer} from '../src/viewer.mjs';
test('本机只读查看器：鉴权、拒绝跨站、拒绝写入、正文不作为 HTML',async t=>{
 const viewer=await createViewer({read:async()=>({messages:[{role:'user',text:'<img src=x onerror=alert(1)>'}]}),enabled:()=>true});t.after(()=>viewer.close());
 const base=viewer.origin;
 assert.equal((await fetch(base+'/api/chat')).status,401);
 assert.equal((await fetch(base+'/api/chat',{headers:{authorization:'Bearer '+viewer.token,origin:'https://evil.example'}})).status,403);
 assert.equal((await fetch(base+'/api/chat',{method:'POST',headers:{authorization:'Bearer '+viewer.token}})).status,405);
 const r=await fetch(base+'/api/chat',{headers:{authorization:'Bearer '+viewer.token}});assert.equal(r.status,200);
 assert.equal((await r.json()).messages[0].text,'<img src=x onerror=alert(1)>');
 const html=await fetch(base+'/');assert.match(html.headers.get('content-security-policy'),/default-src 'none'/);
 const badHost=await new Promise((resolve,reject)=>{http.get(base+'/api/chat',{headers:{authorization:'Bearer '+viewer.token,host:'evil.example'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});
 assert.equal(badHost,403);
 const malformed=await new Promise((resolve,reject)=>{const u=new URL(base);const req=http.request({host:'127.0.0.1',port:u.port,path:'http://[',headers:{host:u.host}},r=>{r.resume();resolve(r.statusCode);});req.on('error',reject);req.end();});assert.equal(malformed,400);
});
test('插件停用立即禁止读取，即使临时钥匙有效',async t=>{
 const viewer=await createViewer({read:async()=>({}),enabled:()=>false});t.after(()=>viewer.close());
 assert.equal((await fetch(viewer.origin+'/api/chat',{headers:{authorization:'Bearer '+viewer.token}})).status,403);
});
