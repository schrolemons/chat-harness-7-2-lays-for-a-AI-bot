import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import yaml from 'js-yaml';
import { PLUGIN, ROOT, STATE } from './src/runtime.mjs';
import { hardenDir } from '../../../src/state-acl.mjs';
const BEGIN='# === codex-peer MCP BEGIN ===';const END='# === codex-peer MCP END ===';
export function patchText(text,entry,remove=false){
  const start=text.indexOf(BEGIN),end=text.indexOf(END);
  if((start<0)!==(end<0)||(start>=0&&end<start)||text.indexOf(BEGIN,start+BEGIN.length)>=0||text.indexOf(END,end+END.length)>=0)throw Error('PATCH_MARKERS_INVALID');
  if(start>=0&&!remove&&isDeepStrictEqual(yaml.load(text.slice(start+BEGIN.length,end)),[{insert:[entry]}]))return text;
  let next=start<0?text:text.slice(0,start)+text.slice(end+END.length).replace(/^\r?\n/,'');
  const rows=yaml.load(next)||[];
  if(!Array.isArray(rows))throw Error('PATCH_NOT_ARRAY');
  // Other installers serialize YAML and remove markers; locate our entry by id too.
  const existing=rows.flatMap(row=>row.insert||[]).filter(item=>item.id===entry.id);
  if(start<0&&!remove&&existing.length===1&&isDeepStrictEqual(existing[0],entry))return text;
  const kept=rows.map(row=>Array.isArray(row.insert)?{...row,insert:row.insert.filter(item=>item.id!==entry.id)}:row).filter(row=>!Array.isArray(row.insert)||row.insert.length);
  next=kept.length?yaml.dump(kept,{lineWidth:-1,noRefs:true}):'';
  if(!remove)next=next.trimEnd()+'\n\n'+BEGIN+'\n'+yaml.dump([{insert:[entry]}],{lineWidth:-1,noRefs:true})+END+'\n';
  if(!next.trim())next='[]\n';
  if(!Array.isArray(yaml.load(next)))throw Error('PATCH_NOT_ARRAY');return next;
}
function discoverCodex(){
  const bin=path.join(process.env.LOCALAPPDATA||'','OpenAI','Codex','bin');
  if(fs.existsSync(bin)){
    const found=fs.readdirSync(bin).map(d=>path.join(bin,d,'codex.exe')).filter(f=>fs.existsSync(f)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
    if(found.length)return found[0];
  }
  throw Error('未找到 Codex。用 --codex-path 指定本机官方 codex.exe 绝对路径。');
}
export function install({profile=path.join(os.homedir(),'.dsh','profiles','desktop'),codexPath,remove=false,dryRun=false,stateDir=STATE}={}){
  const file=path.join(profile,'cordis.patch.yml');const original=fs.readFileSync(file,'utf8');
  const entry={id:'mcp-codex-peer',name:'@deepseek-ai/dsh-mcp-client',config:{serverName:'codex-peer',transport:'stdio',command:process.execPath,args:[path.join(PLUGIN,'src','mcp-server.mjs')],env:{CODEX_PEER_BUILD:'0.1.0-reviewed'},toolCallTimeoutMs:30000}};
  const next=patchText(original,entry,remove);
  if(!remove){codexPath=codexPath||discoverCodex();if(!path.isAbsolute(codexPath)||!fs.statSync(codexPath).isFile())throw Error('INVALID_CODEX_PATH');}
  if(dryRun)return {changed:next!==original,profile,server:'codex-peer',remove};
  if(!remove){
    fs.mkdirSync(path.join(stateDir,'workspace'),{recursive:true,mode:0o700});
    // Reuse the host's audited implementation: never apply directory inheritance flags to files.
    const hardened=hardenDir(stateDir);if(!hardened.ok)throw Error('ACL_FAILED: '+(hardened.detail||'未知原因'));
    for(const name of fs.readdirSync(stateDir))if(name.endsWith('.json'))fs.readFileSync(path.join(stateDir,name));
    fs.writeFileSync(path.join(stateDir,'settings.json'),JSON.stringify({codexPath},null,2),{mode:0o600});
  }
  let backup=null;
  if(next!==original){backup=file+'.bak-codex-peer-'+new Date().toISOString().replace(/[:.]/g,'-');fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);fs.writeFileSync(file,next,'utf8');}
  return {changed:next!==original,profile,server:'codex-peer',remove,backup};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2);const get=flag=>{const i=args.indexOf(flag);if(i<0)return undefined;if(!args[i+1]||args[i+1].startsWith('--'))throw Error('MISSING_ARGUMENT');return args[i+1];};
  try{console.log(JSON.stringify(install({profile:get('--profile'),codexPath:get('--codex-path'),remove:args.includes('--uninstall'),dryRun:args.includes('--dry-run')}),null,2));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
