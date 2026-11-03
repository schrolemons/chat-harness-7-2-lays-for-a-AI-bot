import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
export const forbiddenReleasePath=/(?:^|\/)(?:state|private|private-data|private-libraries|knowledge|user-scripts|node_modules|managed-dependencies|\.instance-install|\.playwright-mcp|\.git|\.worktrees)(?:\/|$)|(?:^|\/)(?:\.qq-bridge-instance(?:-manifest)?\.json|\.qq-bridge-install[^/]*|workspace\.local\.json|source-manifest\.local\.json)(?:\.|$)|(?:^|\/)(?:config|campus-watch|browser-sites)\.json$|\.env(?:\.|$)|\.(?:log|db|sqlite|har)(?:\.|$)|\.bak(?:-|\.|$)|(?:^|\/)(?:Cookies|Login Data|Local State)$/i;
export function checkPrivacy(root,{files:supplied}={}) {
const forbidden=forbiddenReleasePath;
function walk(dir=''){return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e=>{const rel=path.posix.join(dir,e.name);if(e.isSymbolicLink())return [rel];if(e.isDirectory())return /^(?:\.git|node_modules|state|private|user-scripts)$/.test(e.name)?[]:walk(rel);return [rel];});}
let files=supplied;if(!files)try{files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0').filter(Boolean);}catch{files=walk();}
const problems=[];
for(const file of files){const full=path.join(root,file);let stat;try{stat=fs.lstatSync(full);}catch(e){if(e.code==='ENOENT')continue;throw e;}if(forbidden.test(file)){problems.push({file,reason:'runtime/private path'});continue;}if(stat.isSymbolicLink()){problems.push({file,reason:'symlink'});continue;}
 if(/\.(?:png|jpg|jpeg|gif|pdf|zip|tgz|gz|tar|7z|exe|dll|node|mp4)$/i.test(file)){if(file!=='assets/deepseek娘.png'||stat.size>200)problems.push({file,reason:'unreviewed binary'});continue;}
 const text=fs.readFileSync(full,'utf8'),rules=[['private persona wording',/\u6b63\u592a|\u5c0f\u9cb8\u9c7c|\u5c0f\u80a5\u9c7c|\u5927\u80a5\u9c7c|\u54e5\u54e5|\u5446\u840c|\u8f6f\u840c|\u6492\u5a07|\u725b\u5976/],['credential token',/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,})/],['private key material',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{30,}/],['operator home path',/[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[A-Za-z0-9_-]{2,}/],['literal personal conversation key',/(?:private|group):[1-9][0-9]{5,}/],['institutional/personal monitor host',/https?:\/\/[^\s"'`<>]*(?:\.edu\.cn|\.edu\.hk|\.edu\.tw)\b/]];
 for(const [reason,rule]of rules)if(rule.test(text))problems.push({file,reason});
}
return {ok:problems.length===0,files:files.length,problems};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const result=checkPrivacy(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
 console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
}
