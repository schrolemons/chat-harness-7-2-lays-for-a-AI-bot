import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import yaml from 'js-yaml';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const profile=process.argv[2]||path.join(os.homedir(),'.dsh','profiles','desktop');
const file=path.join(profile,'cordis.patch.yml');const raw=fs.readFileSync(file,'utf8');
const begin='# === bridge-health MCP BEGIN ===',end='# === bridge-health MCP END ===';
const start=raw.indexOf(begin),finish=raw.indexOf(end);if((start<0)!==(finish<0)||finish<start||raw.indexOf(begin,start+begin.length)>=0||raw.indexOf(end,finish+end.length)>=0)throw Error('INVALID_MARKERS');
const block=[{insert:[{id:'mcp-bridge-health',name:'@deepseek-ai/dsh-mcp-client',config:{serverName:'bridge-health',transport:'stdio',command:process.execPath,args:[path.join(root,'src','mcp-bridge-health.mjs')],env:{BRIDGE_HEALTH_BUILD:'reviewed-1'},toolCallTimeoutMs:10000}}]}];
if(start>=0&&isDeepStrictEqual(yaml.load(raw.slice(start+begin.length,finish)),block)){console.log('bridge-health 配置已存在，无改动。');}
else{
 const kept=start<0?raw:raw.slice(0,start)+raw.slice(finish+end.length).replace(/^\r?\n/,'');
 const next=kept.trimEnd()+'\n\n'+begin+'\n'+yaml.dump(block,{lineWidth:-1})+end+'\n';if(!Array.isArray(yaml.load(next)))throw Error('INVALID_PROFILE');
 fs.copyFileSync(file,file+'.bak-bridge-health-'+new Date().toISOString().replace(/[:.]/g,'-'),fs.constants.COPYFILE_EXCL);fs.writeFileSync(file,next);console.log('已增加独立只读 bridge-health MCP；其他 MCP 配置未改动。');
}
