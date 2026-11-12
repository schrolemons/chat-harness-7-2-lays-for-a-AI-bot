import {extractPageSnapshot} from '../plugins/qq-components/life-web-watch/web-changes.mjs';

export function allowsAnonymousHttpFallback(url,config={}){
 const target=new URL(url);
 return target.protocol==='http:'&&!target.username&&!target.password&&Array.isArray(config.anonymousHttpFallbackUrls)&&config.anonymousHttpFallbackUrls.includes(target.href);
}

// Only an explicitly configured HTTP URL may use this anonymous static reader.
// It does not downgrade HTTPS, import browser cookies, execute page scripts,
// follow redirects or change any browser-wide HTTPS protection.
export async function readPublicHttpSnapshot(page,url,{fetchImpl=fetch}={}){
 const target=new URL(url);
 if(target.protocol!=='http:'||target.username||target.password)throw Error('Expected a public HTTP URL');
 const response=await fetchImpl(target.href,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(15000),headers:{accept:'text/html'}});
 if(!response.ok)throw Error('Public page HTTP '+response.status);
 if(response.redirected||(response.url&&new URL(response.url).href!==target.href))throw Error('Unexpected public HTTP redirect');
 const type=response.headers.get('content-type')||'';
 if(!/^text\/html\b/i.test(type))throw Error('Public HTTP response is not HTML');
 const max=2*1024*1024,chunks=[];let size=0;
 if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();throw Error('Public HTTP page is too large');}
 for await(const chunk of response.body){size+=chunk.length;if(size>max)throw Error('Public HTTP page is too large');chunks.push(chunk);}
 const bytes=Buffer.concat(chunks),prefix=bytes.subarray(0,2048).toString('ascii');
 const charset=/charset\s*=\s*["']?([\w-]+)/i.exec(type)?.[1]||/charset\s*=\s*["']?([\w-]+)/i.exec(prefix)?.[1]||'utf-8';
 const html=new TextDecoder(charset).decode(bytes),parser=await page.browserContext().newPage();
 try{
  await parser.setJavaScriptEnabled(false);
  await parser.setRequestInterception(true);
  parser.on('request',request=>{void request.abort().catch(()=>{});});
  const inert=await parser.evaluate(html=>{
   const doc=new DOMParser().parseFromString(html,'text/html');
   for(const element of doc.querySelectorAll('script,iframe,frame,object,embed,link,base,meta[http-equiv]'))element.remove();
   const policy=doc.createElement('meta');policy.httpEquiv='Content-Security-Policy';policy.content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'";doc.head.prepend(policy);
   return doc.documentElement.outerHTML;
  },html);
  await parser.setContent(inert,{waitUntil:'domcontentloaded',timeout:5000});
  const snapshot=await parser.evaluate(extractPageSnapshot);
  if(snapshot.password||snapshot.signInPrompt)throw Error('Public HTTP fallback requires authentication; no credentials were sent');
  return {...snapshot,url:target.href,transport:'public-http',httpStatus:response.status};
 }finally{await parser.close();}
}
