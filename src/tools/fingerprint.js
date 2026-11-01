import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parse} from 'acorn';
import {WHALE_MCP_SERVERS} from './servers.js';
import {TOOL_CONFIG_FLAGS} from './flags.js';

const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const stable=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const readJson=(file,fallback={})=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')):fallback;

// Parse without executing components. Local module literals also cover moduleURL/new URL loaders.
// Only components actually declaring registerTool contribute; prompt-only components do not.
export function toolCatalogInputs(root){
 const inputs={},cache=new Map();
 const relative=file=>path.relative(root,file).replaceAll(path.sep,'/');
 const moduleInfo=file=>{
  const absolute=path.resolve(file);if(cache.has(absolute))return cache.get(absolute);
  const local=relative(absolute);if(local.startsWith('../')||path.isAbsolute(local)||!fs.existsSync(absolute))return null;
  const source=fs.readFileSync(absolute,'utf8'),info={file:absolute,local,source,registers:false,dependencies:[]};cache.set(absolute,info);
  const walk=node=>{
   if(!node||typeof node!=='object')return;
   if(node.type==='MemberExpression'&&(node.property?.name==='registerTool'||node.property?.value==='registerTool'))info.registers=true;
   if(node.type==='Literal'&&typeof node.value==='string'&&/^\.\.?\//.test(node.value)&&/\.(?:mjs|js)(?:[?#].*)?$/.test(node.value)){
    const dependency=moduleInfo(path.resolve(path.dirname(absolute),node.value.split(/[?#]/)[0]));if(dependency)info.dependencies.push(dependency);
   }
   for(const [key,value]of Object.entries(node)){if(key==='start'||key==='end')continue;if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}
  };
  walk(parse(source,{ecmaVersion:'latest',sourceType:'module',allowHashBang:true}));return info;
 };
 const graph=entry=>{const seen=new Set(),visit=info=>{if(!info||seen.has(info))return;seen.add(info);info.dependencies.forEach(visit);};visit(moduleInfo(entry));return [...seen];};
 const include=modules=>{for(const info of modules)inputs[info.local]=digest(info.source);};
 for(const server of WHALE_MCP_SERVERS)include(graph(path.join(root,server.script)));
 for(const name of ['src/tools/flags.js','src/tools/servers.js'])include(graph(path.join(root,name)));
 const components=path.join(root,'plugins/qq-components'),toolOwners=[];
 if(fs.existsSync(components))for(const dir of fs.readdirSync(components).sort()){
  const manifestFile=path.join(components,dir,'plugin.json');if(!fs.existsSync(manifestFile))continue;
  const manifest=readJson(manifestFile),modules=graph(path.join(components,dir,manifest.main||'index.js'));
  if(!modules.some(info=>info.registers))continue;
  const id=String(manifest.id||dir);toolOwners.push(id);include(modules);
  inputs[relative(manifestFile)+'#registration']=digest(stable({id,main:manifest.main||'index.js',enabled:manifest.enabled!==false,config:manifest.config||{}}));
  const override=path.join(root,'state/plugins/config',id+'.json');inputs['component-config:'+id]=digest(stable({...manifest.config,...readJson(override)}));
 }
 const registry=readJson(path.join(root,'state/plugins/registry.json'));
 inputs['tool-components']=digest(stable(toolOwners.sort()));
 inputs['tool-component-registry']=digest(stable(Object.fromEntries(['enabled','disabled','order'].map(key=>[key,(Array.isArray(registry[key])?registry[key]:[]).filter(id=>toolOwners.includes(id))]))));
 const config=readJson(path.join(root,'config.json')),mode=readJson(path.join(root,'state/mode.json'));
 inputs['registration-config']=digest(stable({mode:mode.mode||'reserved2',tools:Object.fromEntries([...new Set(Object.values(TOOL_CONFIG_FLAGS))].sort().map(flag=>[flag,config.socialV2?.tools?.[flag]!==false])),bilibili:config.bilibili?.enabled!==false}));
 return Object.fromEntries(Object.entries(inputs).sort(([a],[b])=>a.localeCompare(b)));
}
export const fingerprintInputs=inputs=>digest(stable(inputs));
