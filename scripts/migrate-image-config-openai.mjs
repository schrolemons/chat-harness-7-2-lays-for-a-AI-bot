// One-time removal of retired provider fields; not a runtime compatibility path.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=path.join(root,'state/plugins/config/exec-image-generation.json');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'plugins/qq-components/exec-image-generation/plugin.json'),'utf8'));
const bytes=fs.readFileSync(file),previous=JSON.parse(bytes),removedKeys=Object.keys(previous).filter(k=>!Object.hasOwn(manifest.config,k));
const config=Object.fromEntries(Object.entries(manifest.config).map(([k,v])=>[k,Object.hasOwn(previous,k)?previous[k]:v]));
let jobs=[],secrets={};try{jobs=JSON.parse(fs.readFileSync(path.join(root,'state/image-generation/jobs.json'),'utf8')).jobs||[];}catch{}try{secrets=JSON.parse(fs.readFileSync(path.join(root,'state/image-generation/secret.json'),'utf8'));}catch{}
const pendingJobs=jobs.filter(j=>j.status==='pending').length,apply=process.argv.includes('--apply');
if(apply&&pendingJobs)throw Error('图片任务仍在执行，等待结束后再切换配置');
if(apply&&removedKeys.length){
 const audit=path.join(root,'state/audits/environment-restructure');fs.mkdirSync(audit,{recursive:true});fs.writeFileSync(path.join(audit,'image-config-before-'+Date.now()+'.json'),bytes,{mode:0o600});
 if(!fs.readFileSync(file).equals(bytes))throw Error('配置被另一工作线修改，请重新读取后再迁移');
 const temp=file+'.openai-'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(config,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);
}
console.log(JSON.stringify({mode:apply?'applied':'preview',removedKeys,pendingJobs,openaiBaseConfigured:!!config.apiBase,openaiModelConfigured:!!config.model,openaiKeyConfigured:!!secrets.apiKey,credentialsModified:false},null,2));
