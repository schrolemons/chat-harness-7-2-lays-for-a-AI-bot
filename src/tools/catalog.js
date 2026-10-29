import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WHALE_MCP_SERVERS } from './servers.js';
import { readSessionToolEvidence } from './session-evidence.js';

export function toolCatalogFingerprint(root) {
  const hash=crypto.createHash('sha256');
  for(const server of WHALE_MCP_SERVERS)hash.update(server.name).update(fs.readFileSync(path.join(root,server.script)));
  hash.update(fs.readFileSync(path.join(root,'src/mcp-bilibili-tools.mjs')));
  for(const file of ['src/tools/flags.js','src/tools/servers.js','state/mode.json']) {
    const resolved=path.join(root,file);
    if(fs.existsSync(resolved))hash.update(fs.readFileSync(resolved));
  }
  for(const dir of fs.readdirSync(path.join(root,'plugins/qq-components')).sort()) {
    for(const name of ['plugin.json','index.js']) {
      const file=path.join(root,'plugins/qq-components',dir,name);
      if(fs.existsSync(file))hash.update(fs.readFileSync(file));
    }
  }
  const registry=path.join(root,'state/plugins/registry.json');
  if(fs.existsSync(registry))hash.update(fs.readFileSync(registry));
  const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8').replace(/^\uFEFF/,''));
  hash.update(JSON.stringify({tools:config.socialV2?.tools||{},bilibili:config.bilibili?.enabled}));
  return hash.digest('hex');
}
export async function inspectWhaleMcpServers(root) {
  const servers=[];
  for(const spec of WHALE_MCP_SERVERS) {
    const client=new Client({name:'whale-tool-registration-audit',version:'1.0.0'});
    try {
      const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,spec.script)],cwd:root,stderr:'pipe'});
      await client.connect(transport,{timeout:15000});
      const listed=await client.listTools(undefined,{timeout:15000});
      servers.push({...spec,ok:true,tools:listed.tools.map(({name,description})=>({name,description:description||''}))});
    }catch(error){servers.push({...spec,ok:false,error:error.message,tools:[]});}
    finally{await client.close().catch(()=>{});}
  }
  return {version:1,observedAt:new Date().toISOString(),fingerprint:toolCatalogFingerprint(root),servers};
}
export function readToolCatalog(root) {
  let registered;
  try{registered=JSON.parse(fs.readFileSync(path.join(root,'state/tool-catalog.json'),'utf8'));}
  catch{return {ok:false,error:'尚无实际 MCP tools/list 验证记录，请运行 npm run audit:tools',tools:[],servers:[],sessions:[]};}
  let sessions=[],evidenceError;
  try{sessions=readSessionToolEvidence(root);}catch(error){evidenceError=error.message;}
  const stale=registered.fingerprint!==toolCatalogFingerprint(root);
  const tools=mergeToolEvidence(registered.servers,sessions);
  return {ok:true,stale,observedAt:registered.observedAt,servers:registered.servers.map(({tools,...server})=>({...server,toolCount:tools.length})),sessions:sessions.map(({names,...session})=>({...session,toolCount:names?.length||0})),evidenceError,tools};
}
export function mergeToolEvidence(servers,sessions) {
  const entries=new Map();
  for(const server of servers)for(const tool of server.tools||[]) {
    const qualifiedName=`mcp__${server.name}__${tool.name}`;
    entries.set(qualifiedName,{...tool,qualifiedName,server:server.name,audience:server.audience,layer:server.layer,registered:server.ok===true});
  }
  for(const session of sessions)for(const qualifiedName of session.names||[]) {
    if(entries.has(qualifiedName))continue;
    const server=WHALE_MCP_SERVERS.find(server=>qualifiedName.startsWith(`mcp__${server.name}__`));
    if(!server)continue; // DSH built-ins and unrelated MCPs do not become Whale-owned registrations.
    entries.set(qualifiedName,{name:qualifiedName.slice(`mcp__${server.name}__`.length),qualifiedName,description:'现有会话仍持有此工具；当前 MCP 未注册，需刷新会话工具面。',server:server.name,audience:server.audience,layer:server.layer,registered:false});
  }
  return [...entries.values()].map(tool=>{
    const seen=sessions.filter(session=>session.names?.includes(tool.qualifiedName));
    return {...tool,injectedSessions:seen.length,botInjectedSessions:seen.filter(session=>session.preset==='qq-chat'||session.preset==='qq-chat-v2').length};
  });
}
