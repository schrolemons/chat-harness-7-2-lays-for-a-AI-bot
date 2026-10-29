import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

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
  const workspace=JSON.parse(fs.readFileSync(path.join(root,'workspace.local.json'),'utf8'));
  const home=workspace.dshHome || path.join(os.homedir(),'.dsh');
  const mapping=JSON.parse(fs.readFileSync(path.join(root,'state/sessions.json'),'utf8')).sessions||{};
  const sessionRoot=path.join(home,'sessions');
  const workspaces=fs.readdirSync(sessionRoot,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name);
  const result=[];
  for(const sessionId of new Set(Object.values(mapping))) {
    if(typeof sessionId!=='string'||!/^session-[a-f0-9-]{36}$/i.test(sessionId))continue;
    const folder=workspaces.find(x=>fs.existsSync(path.join(sessionRoot,x,sessionId,'session.v4.jsonl.zstd')));
    if(!folder)continue;
    const file=path.join(sessionRoot,folder,sessionId,'session.v4.jsonl.zstd');
    const stat=fs.statSync(file);
    if(stat.size>32*1024*1024) {result.push({sessionId,error:'会话日志超过只读审计大小限制'});continue;}
    const key=stat.size+':'+stat.mtimeMs;
    try {
      if(cache.get(file)?.key!==key)cache.set(file,{key,value:toolHeaderFromFrames(fs.readFileSync(file))});
      result.push({sessionId,...cache.get(file).value});
    }catch{result.push({sessionId,error:'当前日志正在写入或无法解码；不推断已注入'});}
  }
  return result;
}
