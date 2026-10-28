// Read-only inventory. Never call a model, send QQ, or print private state.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConsoleToken } from '../plugins/qq-components/obs-bridge-health/health.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
const bridge=fs.readFileSync(path.join(root,'src/bridge.js'),'utf8');
const plugins=fs.readdirSync(path.join(root,'plugins/qq-components')).map(id=>{
 const dir=path.join(root,'plugins/qq-components',id);
 if(!fs.existsSync(path.join(dir,'plugin.json')))return null;
 const m=JSON.parse(fs.readFileSync(path.join(dir,'plugin.json'),'utf8'));
 const code=fs.readFileSync(path.join(dir,m.main||'index.js'),'utf8');
 const caps=[...new Set([...code.matchAll(/(?:cap|ctx\.capabilities|ctx\.capabilities\?)\??\.([a-zA-Z]\w*)/g)].map(x=>x[1]))];
 return {id:m.id,layer:m.layer||'registry',hooks:m.hooks||[],schedule:m.schedule||null,hasSkill:fs.existsSync(path.join(dir,'skill.md')),caps,missingCaps:caps.filter(c=>!bridge.includes('taskCaps.'+c+' ='))};
}).filter(Boolean);
let live;
try {const res=await fetch('http://127.0.0.1:'+(cfg.consolePort||3100)+'/api/plugins',{headers:{'x-console-token':resolveConsoleToken(root,cfg)},signal:AbortSignal.timeout(5000)}); const d=await res.json();live={status:res.status,count:d.count,total:d.total,warnings:d.warnings,plugins:d.plugins?.map(p=>({id:p.id,enabled:p.enabled,hooks:p.hooks,tools:p.tools?.map(t=>t.name)}))};}catch(e){live={error:e.message};}
const raw=fs.readFileSync(path.join(root,'state/token-usage.jsonl'),'utf8').trim().split(/\r?\n/).flatMap(l=>{try{return [JSON.parse(l)]}catch{return []}});
// Same sampling axis as ledger: later snapshots replace earlier ones.
const samples=new Map();for(const r of raw)if(r.k==='turn')samples.set([r.sid,r.turn,r.step,r.retry].join(':'),r);
const models={};let min=Infinity,max=0;
for(const r of samples.values()){const m=models[r.model||'unknown']??={steps:0,cacheMiss:0,cacheHit:0,output:0,reasoning:0,maxInput:0};m.steps++;for(const k of ['cacheMiss','cacheHit','output','reasoning'])m[k]+=Number(r.b?.[k])||0;m.maxInput=Math.max(m.maxInput,(r.b?.cacheMiss||0)+(r.b?.cacheHit||0));min=Math.min(min,r.t);max=Math.max(max,r.t);}
console.log(JSON.stringify({generatedAt:new Date().toISOString(),plugins,live,usage:{scope:'deduplicated retained turn samples, not full account bill',from:new Date(min).toISOString(),to:new Date(max).toISOString(),models},globalModel:{model:cfg.dsh?.model,effort:cfg.dsh?.reasoningEffort}},null,2));
