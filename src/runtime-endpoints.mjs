import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
/** Resolve diagnostic clients from the same configuration as the running bridge. */
export function resolveDshBase({explicit,root=ROOT,env=process.env}={}){
 let selected=explicit||env.DSH_BASE_URL||env.DSH_URL;
 if(!selected)try{selected=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8').replace(/^\uFEFF/,'')).dsh?.baseUrl;}catch(e){if(e.code!=='ENOENT')throw Error('DSH_CONFIG_UNREADABLE_OR_INVALID');}
 const base=String(selected||'http://127.0.0.1:3080').replace(/\/+$/,'');
 const url=new URL(base);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('INVALID_DSH_URL');
 return base;
}
