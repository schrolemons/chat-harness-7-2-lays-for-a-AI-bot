import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WHALE_MCP_SERVERS } from './servers.js';
import { readSessionToolEvidence } from './session-evidence.js';
import {toolCatalogInputs,fingerprintInputs} from './fingerprint.js';

export function toolCatalogFingerprint(root) {
  return fingerprintInputs(toolCatalogInputs(root));
}
export async function inspectWhaleMcpServers(root) {
  const servers=[];
  for(const spec of WHALE_MCP_SERVERS) {
    const client=new Client({name:'whale-tool-registration-audit',version:'1.0.0'});
    try {
      const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,spec.script)],cwd:root,stderr:'pipe'});
      await client.connect(transport,{timeout:15000});
      const listed=await client.listTools(undefined,{timeout:15000});
      servers.push({...spec,ok:true,tools:listed.tools.map(({name,description,inputSchema,outputSchema,annotations})=>({name,description:description||'',inputSchema,...(outputSchema?{outputSchema}:{}),...(annotations?{annotations}:{})}))});
    }catch(error){servers.push({...spec,ok:false,error:error.message,tools:[]});}
    finally{await client.close().catch(()=>{});}
  }
  const fingerprintSources=toolCatalogInputs(root);
  return {version:2,observedAt:new Date().toISOString(),fingerprint: fingerprintInputs(fingerprintSources),fingerprintSources,servers};
}
export function readToolCatalog(root) {
  let registered;
  try{registered=JSON.parse(fs.readFileSync(path.join(root,'state/tool-catalog.json'),'utf8'));}
  catch{return {ok:false,error:'尚无实际 MCP tools/list 验证记录，请运行 npm run audit:tools',tools:[],servers:[],sessions:[]};}
  let sessions=[],evidenceError;
  try{sessions=readSessionToolEvidence(root);}catch(error){evidenceError=error.message;}
  const currentSources=toolCatalogInputs(root),stale=registered.version!==2||registered.fingerprint!==fingerprintInputs(currentSources);
  const changedInputs=registered.fingerprintSources?Object.keys({...registered.fingerprintSources,...currentSources}).filter(key=>registered.fingerprintSources[key]!==currentSources[key]):[];
  const tools=mergeToolEvidence(registered.servers,sessions);
  return {ok:true,stale,freshness:stale?'unverified':'verified',changedInputs,observedAt:registered.observedAt,servers:registered.servers.map(({tools,...server})=>({...server,toolCount:tools.length})),sessions:sessions.map(({names,...session})=>({...session,toolCount:names?.length||0})),evidenceError,tools};
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
