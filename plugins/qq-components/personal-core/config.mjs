import fs from 'node:fs';import path from 'node:path';
export const DEFAULT_CONFIG=Object.freeze({libraryDir:'',referenceSessionKeys:[],careSessionKeys:[],catalogPageSize:12,maxReadChars:4000});
export function projectRoot(dir){return path.resolve(dir,'../../..');}
export function loadLocalConfig(dir,root=projectRoot(dir)){
 const read=(file,fallback)=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')):fallback;
 const manifest=read(path.join(dir,'plugin.json'),{}),state=path.join(root,'state/plugins'),override=read(path.join(state,'config/personal-core.json'),{}),registry=read(path.join(state,'registry.json'),{});
 const disabled=(manifest.enabled===false&&!(registry.enabled||[]).includes('personal-core'))||(registry.disabled||[]).includes('personal-core');
 return {manifest,config:{...DEFAULT_CONFIG,...manifest.config,...override},disabled,root};
}
export const mountedPath=(root,config)=>config.libraryDir?.trim()?path.resolve(root,config.libraryDir.trim()):'';
export function validateSettings(config){
 const errors=[];if(typeof config.libraryDir!=='string'||config.libraryDir.length>4096)errors.push('资料包目录必须为文本');
 for(const key of ['referenceSessionKeys','careSessionKeys'])if(!Array.isArray(config[key])||config[key].some(x=>typeof x!=='string'||!/^(private|group):[1-9]\d*$/.test(x)))errors.push(key+' 必须为完整会话标识数组');
 for(const [key,min,max]of [['catalogPageSize',1,30],['maxReadChars',200,20000]])if(!Number.isInteger(config[key])||config[key]<min||config[key]>max)errors.push(key+' 超出允许范围');
 return {ok:errors.length===0,errors};
}
