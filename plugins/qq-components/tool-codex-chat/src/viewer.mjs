import http from 'node:http';
import fs from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
const files=new Map([['/',['index.html','text/html; charset=utf-8']],['/viewer.js',['viewer.js','text/javascript; charset=utf-8']],['/viewer.css',['viewer.css','text/css; charset=utf-8']]]);
export async function createViewer({read,enabled}) {
 const token=randomBytes(32).toString('hex');let origin;let cached;let cacheAt=0;let reading;
 const server=http.createServer(async(req,res)=>{
  const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'cross-origin-resource-policy':'same-origin'};
  const send=(status,value,type='application/json; charset=utf-8')=>{res.writeHead(status,{...headers,'content-type':type});res.end(type.startsWith('application/json')?JSON.stringify(value):value);};
  if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'LOCAL_ONLY'});
  if(req.method!=='GET')return send(405,{error:'READ_ONLY'});
  let pathname;try{pathname=new URL(req.url,origin).pathname;}catch{return send(400,{error:'INVALID_URL'});}
  if(files.has(pathname)){const[file,type]=files.get(pathname);return send(200,fs.readFileSync(new URL('../public/'+file,import.meta.url)),type);}
  if(pathname!=='/api/chat')return send(404,{error:'NOT_FOUND'});
  const received=Buffer.from(String(req.headers.authorization||'').replace(/^Bearer /,''));const expected=Buffer.from(token);
  if(received.length!==expected.length||!timingSafeEqual(received,expected))return send(401,{error:'VIEW_KEY_REQUIRED'});
  if(!enabled())return send(403,{error:'PLUGIN_DISABLED'});
  try{
   if(!cached||Date.now()-cacheAt>1200){reading??=Promise.resolve().then(read).then(data=>{cached=data;cacheAt=Date.now();return data;}).finally(()=>{reading=null;});await reading;}
   send(200,cached);
  }catch{send(503,{error:'CHAT_NOT_READY'});}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;server.maxHeadersCount=30;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
 origin='http://127.0.0.1:'+server.address().port;
 return {origin,token,url:origin+'/#key='+token,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};
}
