// One platform owns one browser context and one local session file. Redirected
// identity providers stay inside that context; no account/password is filled.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {loginOrigin} from '../plugins/qq-components/life-web-watch/login-recovery.mjs';

export function createSiteSessions(root,browser,{strictClose=false}={}) {
  const sessions=new Map(),directory=path.join(root,'state','web-watch-site-sessions');
  let closing=false,stopping;const creating=new Set();
  const fileFor=origin=>path.join(directory,crypto.createHash('sha256').update(origin).digest('hex')+'.json');
  const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
  async function sample(ctx,storage){
    for(const page of await ctx.pages()){
      if(page.isClosed())continue;
      const snapshot=await page.evaluate(()=>{
        if(!/^https?:$/.test(location.protocol))return null;
        return {origin:location.origin,localStorage:Object.fromEntries(Object.entries(localStorage)),sessionStorage:Object.fromEntries(Object.entries(sessionStorage))};
      }).catch(()=>null);
      if(snapshot)storage.set(snapshot.origin,snapshot);
    }
  }
  async function createContext(url) {
    const origin=loginOrigin(url);
    if(sessions.has(origin))return sessions.get(origin).context;
    const file=fileFor(origin),saved=read(file);
    if(saved&&saved.origin!==origin)throw Error('网站会话归属不匹配，未复用登录态');
    const ctx=await browser.createBrowserContext();
    try {
      const previous=saved||{origin,storage:[]};
      const cookies=saved?.cookies||[];
      // Keep original domain/path scope and never import another site's jar.
      const valid=cookies.filter(c=>c&&typeof c.name==='string'&&typeof c.value==='string'&&c.domain&&(!(c.expires>0)||c.expires*1000>Date.now()));
      if(valid.length)await ctx.setCookie(...valid);
      const storage=new Map((previous.storage||[]).map(row=>[row.origin,row]));
      const createPage=ctx.newPage.bind(ctx);
      ctx.newPage=async()=>{
        await sample(ctx,storage);
        const page=await createPage();
        for(const saved of storage.values()){
          const script=await page.evaluateOnNewDocument(saved=>{
            if(saved.origin!==location.origin)return;
            try{for(const [key,value]of Object.entries(saved.localStorage||{}))if(localStorage.getItem(key)===null)localStorage.setItem(key,value);for(const [key,value]of Object.entries(saved.sessionStorage||{}))if(sessionStorage.getItem(key)===null)sessionStorage.setItem(key,value);}catch{}
          },saved);
          const once=frame=>{if(frame===page.mainFrame()&&new URL(frame.url()).origin===saved.origin){page.off('framenavigated',once);void page.removeScriptToEvaluateOnNewDocument(script.identifier).catch(()=>{});}};
          page.on('framenavigated',once);
        }
        return page;
      };
      sessions.set(origin,{context:ctx,file,storage});
      return ctx;
    }catch(error){try{await ctx.close();}catch(closeError){if(strictClose)throw new AggregateError([error,closeError],'Owned context rollback failed');}throw error;}
  }
  function context(url){
    if(closing)return Promise.reject(Error('SESSION_CLOSING'));
    const operation=createContext(url);creating.add(operation);operation.finally(()=>creating.delete(operation)).catch(()=>{});return operation;
  }
  async function checkpoint() {
    fs.mkdirSync(directory,{recursive:true});
    for(const [origin,item]of sessions){
      await sample(item.context,item.storage);
      const doc={version:1,origin,cookies:await item.context.cookies(),storage:[...item.storage.values()],updatedAt:Date.now()};
      const temp=item.file+'.'+crypto.randomUUID()+'.tmp';
      fs.writeFileSync(temp,JSON.stringify(doc),{mode:0o600});fs.renameSync(temp,item.file);
    }
  }
  return {context,async page(url){const ctx=await context(url);return (await ctx.pages()).find(page=>!page.isClosed())||ctx.newPage();},checkpoint,
    close(){
      closing=true;
      return stopping??=(async()=>{
        const failures=[];const settled=await Promise.allSettled([...creating]);
        if(strictClose)for(const result of settled)if(result.status==='rejected')failures.push(result.reason);
        try{await checkpoint();}catch(error){failures.push(error);}
        for(const [origin,item] of sessions){try{await item.context.close();sessions.delete(origin);}catch(error){if(strictClose)failures.push(error);else sessions.delete(origin);}}
        if(failures.length)throw new AggregateError(failures,failures.map(error=>error.message).join('; '));
      })();
    }
  };
}
