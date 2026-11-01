// Bridge-owned adapter: the independently versioned grabber never receives a
// general browser cookie jar, another platform's credentials or an old export.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export function syncLectureCookies(root,integrationDirectory){
  const jar=JSON.parse(fs.readFileSync(path.join(root,'state','campus-lecture-cookies.json'),'utf8'));
  if(!Array.isArray(jar))throw Error('讲座独立会话导出格式错误');
  const keys=new Set(['GS_DBLOGIN_TOKEN','GS_SESSIONID','EMAP_LANG','THEME','_WEU','route']),cookies={};
  for(const item of jar)if(item&&String(item.domain||'').replace(/^\./,'')==='yjs1.ustc.edu.cn'&&keys.has(item.name)&&typeof item.value==='string'&&(!(item.expires>0)||item.expires*1000>Date.now()))cookies[item.name]=item.value;
  if(!Object.keys(cookies).length)throw Error('没有有效的讲座平台Cookie，未执行脚本');
  const destination=path.join(integrationDirectory,'config.yml'),template=path.join(integrationDirectory,'templates','config.template.yml');
  const config=yaml.load(fs.readFileSync(fs.existsSync(destination)?destination:template,'utf8'))||{};
  config.cookies=cookies;config.enable_grade_check=false;
  const temp=destination+'.'+process.pid+'.tmp';
  fs.writeFileSync(temp,yaml.dump(config,{lineWidth:-1,noRefs:true}),{mode:0o600});fs.renameSync(temp,destination);
}
