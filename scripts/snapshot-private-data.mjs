import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {bridgeHistory,sessionRows,writeSession} from './private-history.mjs';

const ROOT_FILES=['config.json','browser-sites.json'];
const STATE_FILES=['current-role.json','mode.json','initial-prompts.json','person-profiles.json','user-profiles.json','slang.json','stickers.json','feedback.json','tasks.json','time-bubbles.json','time-bubble-locks.json','sessions.json','social-v2.json','script-heartbeats.json','token-usage.jsonl'];
const STATE_DIRECTORIES=['state/memory','state/plugins','state/migrations'];
const SECRET_KEY=/^(?:token|consoleToken|accessToken|authToken|agentToken|apiKey|api[_-]key|password|passwd|secret|cookie|cookies|authorization|bearerToken|launchToken|refreshToken|sessionToken)$|(?:api[_-]?key|access[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)$/i;
const MARKER='<LOCAL_CREDENTIAL>';
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

function stableRead(file) {
  for(let attempt=0;attempt<3;attempt++) {
    const before=fs.statSync(file);const bytes=fs.readFileSync(file);const after=fs.statSync(file);
    if(before.size===after.size&&before.mtimeMs===after.mtimeMs)return bytes;
  }
  throw new Error('数据正在持续写入，请重试快照：'+path.basename(file));
}
export function snapshotPrivateData(root,options={}) {
  const localMap=path.join(root,'workspace.local.json');
  const dshHome=options.dshHome||(fs.existsSync(localMap)?JSON.parse(fs.readFileSync(localMap,'utf8')).dshHome:null);
  const history=bridgeHistory(root,dshHome);
  const target=path.join(root,'private-data');
  const paths=ROOT_FILES.concat(STATE_FILES.map(file=>'state/'+file));
  function collect(relative) {
    const absolute=path.join(root,relative);
    if(!fs.existsSync(absolute))return;
    const stat=fs.lstatSync(absolute);
    if(stat.isSymbolicLink())return;
    if(stat.isDirectory())for(const name of fs.readdirSync(absolute).sort())collect(relative+'/'+name);
    else if(/\.(?:json|jsonl|md|txt)$/i.test(relative)&&!/(?:\.bak|\.tmp|_optimization-legacy)/.test(relative))paths.push(relative);
  }
  STATE_DIRECTORIES.forEach(collect);
  const raw=new Map();const secrets=new Set();const redactions=[];
  for(const relative of [...new Set(paths)].sort()) {
    const file=path.join(root,relative);if(!fs.existsSync(file))continue;
    if(fs.lstatSync(file).isSymbolicLink())throw new Error('不快照符号链接：'+relative);
    const bytes=stableRead(file);
    if(bytes.length>40*1024*1024)throw new Error('数据文件过大，应单独制定备份方式：'+relative);
    raw.set(relative,bytes);
  }
  function findSecrets(value,sensitive=false,depth=0) {
    if(typeof value==='string'){if(sensitive&&value)secrets.add(value);else if(depth<10&&/^[\s]*[\[{]/.test(value)){try{findSecrets(JSON.parse(value),false,depth+1);}catch{}}return;}
    if(Array.isArray(value)){for(const item of value)findSecrets(item,sensitive,depth+1);return;}
    if(!value||typeof value!=='object')return;
    // A tool schema may itself define a property named token. Its schema
    // object is not a credential; only actual sensitive scalar values qualify.
    for(const [key,item] of Object.entries(value))findSecrets(item,SECRET_KEY.test(key)||/signing.*key|credential.*secret/i.test(key),depth+1);
  }
  for(const [relative,bytes] of raw) {
    const text=bytes.toString('utf8').replace(/^\uFEFF/,'');
    if(relative.endsWith('.json'))findSecrets(JSON.parse(text));
    else if(relative.endsWith('.jsonl'))for(const line of text.split('\n').filter(line=>line.trim()))findSecrets(JSON.parse(line));
  }
  for(const relative of ['state/console-token']) {
    const file=path.join(root,relative);if(fs.existsSync(file)){const value=fs.readFileSync(file,'utf8').trim();if(value.length>=8)secrets.add(value);}
  }
  if(dshHome){const credentials=path.join(dshHome,'.credentials.yaml');if(fs.existsSync(credentials))findSecrets(yaml.load(fs.readFileSync(credentials,'utf8')));}
  for(const item of history)for(const row of sessionRows(item.bytes,item.file.endsWith('.zstd')))findSecrets(row);
  const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const secretPattern=secrets.size?new RegExp([...secrets].sort((a,b)=>b.length-a.length).map(value=>value.length>=8?escape(value):'(?<![A-Za-z0-9])'+escape(value)+'(?![A-Za-z0-9])').join('|'),'g'):null;
  function cleanText(value) {
    const text=secretPattern?value.replace(secretPattern,MARKER):value;
    return text.replace(/([?&](?:token|access_token|api_key|secret|password)=)[^&#\s"'<>]+/gi,'$1'+MARKER)
      .replace(/(\bAuthorization\s*[:=]\s*["']?(?:Bearer|Basic)\s+)[A-Za-z0-9+/_=.:-]+/gi,'$1'+MARKER)
      .replace(/(\bCookie\s*:\s*)[^\r\n"'<>]+/gi,'$1'+MARKER)
      .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{20,}/g,MARKER)
      .replace(/((?:api[_-]?key|access[_-]?token|password|authToken|consoleToken|agentToken|signing[_-]?key)["']?\s*[:=]\s*["']?)([^\s"',}\]]{8,})/gi,'$1'+MARKER);
  }
  function clean(value,location,sensitive=false) {
    if(typeof value==='string'){if(sensitive){redactions.push(location);return MARKER;}return cleanText(value);}
    if(Array.isArray(value))return value.map((item,i)=>clean(item,location+'['+i+']',sensitive));
    if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value).map(([key,item])=>{
      return [key,clean(item,location+'.'+key,SECRET_KEY.test(key))];
    }));
  }
  const stage=path.join(root,'.private-data-stage-'+process.pid+'-'+crypto.randomBytes(5).toString('hex'));
  fs.mkdirSync(stage,{recursive:true});
  const files=[];
  for(const [relative,bytes] of raw) {
    const text=bytes.toString('utf8').replace(/^\uFEFF/,'');
    let output;
    if(relative.endsWith('.json'))output=JSON.stringify(clean(JSON.parse(text),relative),null,2)+'\n';
    else if(relative.endsWith('.jsonl'))output=text.split('\n').filter(line=>line.trim()).map((line,i)=>JSON.stringify(clean(JSON.parse(line),relative+':'+(i+1)))).join('\n')+'\n';
    else output=cleanText(text);
    const out=path.join(stage,relative);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,output);
    files.push({path:relative,sourceSha256:digest(bytes),snapshotSha256:digest(output),sourceBytes:bytes.length,snapshotBytes:Buffer.byteLength(output)});
  }
  const attachments=new Map();
  for(const [index,item]of history.entries()){
    const bytes=item.bytes;
    // Native project slugs can exceed Windows Git's path limit. The manifest
    // preserves identity and cwd; the portable archive needs only a short key.
    const relative='dsh/sessions/'+digest(item.id+'\0'+item.cwd).slice(0,20)+'.jsonl.zstd';
    const result=writeSession(path.join(stage,relative),sessionRows(bytes,item.file.endsWith('.zstd')),{clean:row=>clean(row,relative),observe:row=>{
      for(const hash of JSON.stringify(row).match(/\b[a-f0-9]{64}\b/g)||[])if(!attachments.has(hash)){const source=path.join(dshHome,'attachments/v1/objects',hash.slice(0,2),hash);attachments.set(hash,fs.existsSync(source)?source:null);}
    }});
    files.push({path:relative,kind:'dsh-session',sessionId:item.id,cwd:item.cwd,sourceSha256:item.sourceSha256,sourceBytes:bytes.length,...result});
    options.onProgress?.({sessions:index+1,total:history.length});
  }
  for(const [hash,source]of attachments)if(source){if(fs.lstatSync(source).isSymbolicLink())throw Error('Attachment symlink is not portable');const bytes=stableRead(source);if(digest(bytes)!==hash)throw Error('Attachment content hash mismatch');const relative='dsh/attachments/v1/objects/'+hash.slice(0,2)+'/'+hash;const out=path.join(stage,relative);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);files.push({path:relative,kind:'dsh-attachment',sourceSha256:hash,snapshotSha256:hash,sourceBytes:bytes.length,snapshotBytes:bytes.length});}
  const manifest={version:2,capturedAt:new Date().toISOString(),sourceRoot:path.resolve(root),sourceDshHome:dshHome||null,historySessions:history.length,purpose:'私人部署逻辑数据与原始会话备份；只推送指定私有仓库',files,redactedFields:[...new Set(redactions)],excluded:['访问令牌/密钥/密码/cookie','浏览器profiles和登录数据库','其他工程的DSH会话','操作日志、未引用缓存、临时工作区、旧备份']};
  fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const readme=path.join(target,'README.md');
  if(fs.existsSync(readme))fs.copyFileSync(readme,path.join(stage,'README.md'));
  const backup=path.join(root,'state/audits/private-data-snapshots',Date.now()+'-'+process.pid);
  const absoluteRoot=path.resolve(root)+path.sep;
  if(![target,stage,backup].every(file=>path.resolve(file).startsWith(absoluteRoot))||path.basename(target)!=='private-data'||!path.basename(stage).startsWith('.private-data-stage-'))throw new Error('Invalid private snapshot replacement paths');
  const previous=fs.existsSync(target);
  if(previous){fs.mkdirSync(path.dirname(backup),{recursive:true});fs.renameSync(target,backup);}
  try{fs.renameSync(stage,target);}catch(error){if(previous)fs.renameSync(backup,target);throw error;}
  return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const manifest=snapshotPrivateData(root,{onProgress:p=>{if(p.sessions%20===0)console.log(JSON.stringify({historySessions:p.sessions,total:p.total}));}});
  console.log(JSON.stringify({files:manifest.files.length,bytes:manifest.files.reduce((n,file)=>n+file.snapshotBytes,0),credentialFieldsExcluded:manifest.redactedFields.length}));
}
