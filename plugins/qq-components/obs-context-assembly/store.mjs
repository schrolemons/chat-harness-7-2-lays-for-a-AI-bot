import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {normalizePolicy} from './policy.mjs';
import {redact} from './packet.mjs';
export const POLICY_ID='obs-context-assembly';
export function readJson(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
export function writeJson(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.'+randomBytes(4).toString('hex')+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
export function policyFile(root){return path.join(root,'state/plugins/config',POLICY_ID+'.json');}
export function readPolicy(root){const policy=normalizePolicy(readJson(policyFile(root),{})),registry=readJson(path.join(root,'state/plugins/registry.json'),{});return registry.disabled?.includes(POLICY_ID)?{...policy,enabled:false}:policy;}
export function secretFor(root){const file=path.join(root,'state/context-assembly/packet.key');try{return fs.readFileSync(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;fs.mkdirSync(path.dirname(file),{recursive:true});try{fs.writeFileSync(file,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}return fs.readFileSync(file,'utf8');}}
function stem(value){return createHash('sha256').update(String(value)).digest('hex').slice(0,32);}
export function evidenceFile(root,key,kind='assembly'){if(!['assembly','request','consumer','packet'].includes(kind))throw Error('无效 context 证据类型');return path.join(root,'state/context-assembly',kind,stem(key)+'.json');}
function scrub(value){if(typeof value==='string'){if(/^[\[{]/.test(value))try{const parsed=JSON.parse(value);if(parsed&&typeof parsed==='object')return JSON.stringify(scrub(parsed));}catch{}return redact(value);}if(Array.isArray(value))return value.map(scrub);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,/^(token|agent_?token|api_?key|secret|signature|authorization|cookie)$/i.test(k)?'[已隐藏]':scrub(v)]));return value;}
export function recordEvidence(root,key,kind,data){
 const file=evidenceFile(root,key,kind),safe=scrub(data);
 if(kind!=='request'){writeJson(file,safe);return;}
 const previous=readJson(file),{recentRequests:_old,requestStages:_stages,initialRequest:_initial,...last}=previous||{};
 const sameRound=!!safe.nonce&&safe.nonce===previous?.nonce;
 const initial=sameRound?(previous.initialRequest||(last.requestInRound===1?last:null)):(safe.requestInRound===1?safe:null);
 const prior=sameRound?last:null;
 const stages=[{kind:'initial',label:'本轮初始请求',request:initial},{kind:'previous',label:'上一次请求',request:prior},{kind:'current',label:'当前请求',request:safe}];
 writeJson(file,{...safe,initialRequest:initial,requestStages:stages,recentRequests:[safe,prior,initial].filter((row,index,rows)=>row&&rows.findIndex(other=>other?.requestId===row.requestId&&other?.at===row.at)===index)});
}
export function readEvidence(root,key,kind='assembly'){return readJson(evidenceFile(root,key,kind));}
export function listAssemblies(root){const dir=path.join(root,'state/context-assembly/assembly');try{return fs.readdirSync(dir).filter(x=>/^[a-f0-9]{32}\.json$/.test(x)).map(x=>readJson(path.join(dir,x))).filter(Boolean).map(x=>({key:x.key,sessionId:x.sessionId,scene:x.scene,at:x.at})).sort((a,b)=>b.at-a.at).slice(0,100);}catch{return [];}}
