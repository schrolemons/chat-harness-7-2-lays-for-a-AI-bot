import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const forbidden=/(?:^|\/)(?:state|private|user-scripts|node_modules|\.playwright-mcp|\.git)(?:\/|$)|(?:^|\/)(?:config|campus-watch|browser-sites)\.json$|\.env(?:\.|$)|\.(?:log|db|sqlite|har)(?:\.|$)|\.bak(?:-|\.|$)|(?:^|\/)(?:Cookies|Login Data|Local State)$/i;
function walk(dir=''){return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e=>{const rel=path.posix.join(dir,e.name);if(e.isSymbolicLink())return [rel];if(e.isDirectory())return /^(?:\.git|node_modules|state|private|user-scripts)$/.test(e.name)?[]:walk(rel);return [rel];});}
let files;try{files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0').filter(Boolean);}catch{files=walk();}
const problems=[];
for(const file of files){if(forbidden.test(file)){problems.push({file,reason:'runtime/private path'});continue;}const full=path.join(root,file),stat=fs.lstatSync(full);if(stat.isSymbolicLink()){problems.push({file,reason:'symlink'});continue;}
 if(/\.(?:png|jpg|jpeg|gif|pdf|zip|exe|dll|node|mp4)$/i.test(file)){if(file!=='assets/deepseek娘.png'||stat.size>200)problems.push({file,reason:'unreviewed binary'});continue;}
 const text=fs.readFileSync(full,'utf8'),rules=[['credential token',/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,})/],['private key material',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{30,}/],['operator home path',/[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[A-Za-z0-9_-]{2,}/],['literal personal conversation key',/(?:private|group):[1-9][0-9]{5,}/],['institutional/personal monitor host',/https?:\/\/[^\s"'`<>]*(?:\.edu\.cn|\.edu\.hk|\.edu\.tw)\b/]];
 for(const [reason,rule]of rules)if(rule.test(text))problems.push({file,reason});
}
console.log(JSON.stringify({ok:problems.length===0,files:files.length,problems},null,2));if(problems.length)process.exitCode=1;
