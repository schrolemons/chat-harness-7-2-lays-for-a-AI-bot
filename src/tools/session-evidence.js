import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { loadInstanceSessionPolicy } from '../instance-session-policy.mjs';

// Only tool names and request timestamps leave this reader. Messages, arguments and prompts are discarded.
export function toolHeaderFromFrames(bytes) {
  if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('当前 Node 不支持 DSH 日志的 Zstandard 解码');
  let offset=0, result={preset:'', names:[], observedAt:null};
  for(let frame=0;offset<bytes.length && frame<100000;frame++) {
    const {buffer,engine}=zlib.zstdDecompressSync(bytes.subarray(offset),{info:true,maxOutputLength:8*1024*1024});
    if(!engine.bytesWritten) throw new Error('无效的 DSH 日志帧');
    offset+=engine.bytesWritten;
    for(const line of buffer.toString('utf8').split('\n')) {
      if(!line.trim())continue;
      const event=JSON.parse(line);
      if(event.type==='session')result.preset=typeof event.agentPreset==='string'?event.agentPreset:'';
      if(event.type==='request/header') {
        result.names=(event.data?.header?.tools||[]).map(tool=>tool.name).filter(name=>typeof name==='string');
        result.observedAt=event.time||event.timestamp||event.ts||null;
      }
    }
  }
  return result;
}
const cache=new Map();
export function readSessionToolEvidence(root) {
  const mapping=JSON.parse(fs.readFileSync(path.join(root,'state/sessions.json'),'utf8')).sessions||{};
  const policy=loadInstanceSessionPolicy({root,env:{}});
  let locate;
  if (policy.active) {
    const descriptor=JSON.parse(fs.readFileSync(path.join(root,'.qq-bridge-instance.json'),'utf8'));
    const receipt=JSON.parse(fs.readFileSync(path.join(root,'.qq-bridge-instance-manifest.json'),'utf8'));
    const normalize=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
    if(receipt.instanceId!==descriptor.instanceId||normalize(receipt.root)!==normalize(root)
      ||normalize(receipt.dshHome)!==normalize(descriptor.dshHome))throw Error('工具审计实例归属不匹配');
    const base=normalize(fs.realpathSync(path.join(descriptor.dshHome,'sessions')));
    const owned=new Map(receipt.sessions.filter(row=>['created','verified-legacy'].includes(row.source)&&row.headerFingerprint&&row.workspaceId)
      .map(row=>[row.sessionId,row.path]));
    locate=id=>{
      const candidate=owned.get(id);
      if(!candidate||!path.isAbsolute(candidate)||path.basename(candidate)!=='session.v4.jsonl.zstd'||path.basename(path.dirname(candidate))!==id)return;
      let real;try{real=fs.realpathSync(candidate);}catch(error){if(error.code==='ENOENT')return;throw error;}
      const relative=path.relative(base,normalize(real));
      if(relative&&!path.isAbsolute(relative)&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&normalize(candidate)===normalize(real))return real;
    };
  } else {
    const workspace=JSON.parse(fs.readFileSync(path.join(root,'workspace.local.json'),'utf8'));
    const sessionRoot=path.join(workspace.dshHome||path.join(os.homedir(),'.dsh'),'sessions');
    const workspaces=fs.readdirSync(sessionRoot,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name);
    locate=id=>workspaces.map(folder=>path.join(sessionRoot,folder,id,'session.v4.jsonl.zstd')).find(file=>fs.existsSync(file));
  }
  const result=[];
  for(const sessionId of new Set(Object.values(mapping))) {
    if(typeof sessionId!=='string'||!/^session-[a-f0-9-]{36}$/i.test(sessionId))continue;
    const file=locate(sessionId);
    if(!file)continue;
    const stat=fs.statSync(file);
    if(stat.size>32*1024*1024) {result.push({sessionId,error:'会话日志超过只读审计大小限制'});continue;}
    const key=stat.size+':'+stat.mtimeMs;
    try {
      if(cache.get(file)?.key!==key)cache.set(file,{key,value:toolHeaderFromFrames(fs.readFileSync(file))});
      const evidence=cache.get(file).value;
      result.push({sessionId,...evidence,preset:policy.canonicalPreset(evidence.preset)});
    }catch{result.push({sessionId,error:'当前日志正在写入或无法解码；不推断已注入'});}
  }
  return result;
}
