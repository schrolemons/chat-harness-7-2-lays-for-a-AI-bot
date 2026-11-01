// One-time correction for uncertain notes restored into slang meanings.
import fs from 'node:fs';
import path from 'node:path';
import {resolveConsoleToken} from '../plugins/qq-components/obs-bridge-health/health.mjs';

const root=path.resolve(import.meta.dirname,'..');
const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
const base=`http://127.0.0.1:${cfg.consolePort||3100}`;
const headers={'x-console-token':resolveConsoleToken(root,cfg),'content-type':'application/json'};
const response=await fetch(`${base}/api/slang`,{headers,signal:AbortSignal.timeout(10000)});
if(!response.ok)throw new Error(`Read failed: HTTP ${response.status}`);
const data=await response.json();
const targets=data.entries.filter(e=>e.status==='candidate'&&String(e.meaning||'').startsWith('研究未确定：'));
if(!targets.length){console.log('No uncertain meaning placeholders remain.');process.exit(0);}
const backupDir=path.join(root,'state','repair-backups','slang-uncertain-cleanup-20261027');
fs.mkdirSync(backupDir,{recursive:true});
const backupPath=path.join(backupDir,`slang-before-${Date.now()}.json`);
fs.writeFileSync(backupPath,JSON.stringify(data.entries,null,2)+'\n');
console.log(`Backed up ${data.entries.length} entries; correcting ${targets.length} candidate placeholders.`);
let updated=0;
for(const entry of targets){
  const note=String(entry.meaning).replace(/^研究未确定：(?:不确定。)?/,'').trim();
  const previousRisk=String(entry.risk||'').replace(/(?:^|；)自动研究结果，待管理员核实/g,'').replace(/^；|；$/g,'').trim();
  const risk=`研究未确定：${note||'群内语境不足，无法确认含义。'}${previousRisk?'；'+previousRisk:''}`;
  const res=await fetch(`${base}/api/slang/${encodeURIComponent(entry.id)}`,{
    method:'PATCH',headers,body:JSON.stringify({meaning:'',usage:'',example:'',risk}),signal:AbortSignal.timeout(10000)
  });
  const body=await res.json();
  if(!res.ok||body.ok!==true)throw new Error(`PATCH failed for ${entry.id}: HTTP ${res.status} ${body.error||''}; updated ${updated}`);
  updated++;
}
const verifyResponse=await fetch(`${base}/api/slang`,{headers,signal:AbortSignal.timeout(10000)});
if(!verifyResponse.ok)throw new Error(`Verify failed: HTTP ${verifyResponse.status}`);
const verify=(await verifyResponse.json()).entries;
const remaining=verify.filter(e=>e.status==='candidate'&&String(e.meaning||'').startsWith('研究未确定：'));
const repaired=targets.filter(t=>{const e=verify.find(v=>v.id===t.id);return e&&e.status==='candidate'&&e.meaning===''&&String(e.risk||'').startsWith('研究未确定：');});
console.log(JSON.stringify({updated,repaired:repaired.length,remaining:remaining.length,backupPath}));
if(remaining.length||repaired.length!==targets.length)process.exitCode=1;
