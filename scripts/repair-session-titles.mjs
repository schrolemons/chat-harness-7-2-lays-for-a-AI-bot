import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeApiClient,unwrap} from '../src/dsh-client.js';
import {isUnnamedTitle,sessionTitle} from '../src/session-titles.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(name,fallback={})=>{try{return JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));}catch{return fallback;}};
const config=read('config.json');
const api=new NodeApiClient(config.dsh.baseUrl,8000,config.dsh.authToken?{token:config.dsh.authToken}:{});
const mapped=read('state/sessions.json').sessions||{};
const keys=new Map(Object.entries(mapped).map(([key,id])=>[id,key]));
const tasks=Object.values(read('state/tasks.json').tasks||{});
const rows=unwrap(await api.sessions.list({}),'session.list').items;
const plan=rows.filter(row=>isUnnamedTitle(row.projections?.values?.title)).map(row=>{
  const task=tasks.find(task=>task.sessionId===row.sessionId);
  return {sessionId:row.sessionId,before:row.projections?.values?.title??null,after:sessionTitle({sessionId:row.sessionId,agentPreset:row.projections?.values?.agentPreset,cwd:row.cwd,key:keys.get(row.sessionId),title:task?.title?'任务 · '+task.title:''})};
});
if(!process.argv.includes('--apply')) {console.log(JSON.stringify({total:rows.length,unnamed:plan.length,plan},null,2));process.exit(0);}
const dir=path.join(root,'state','session-title-repair-'+Date.now());fs.mkdirSync(dir);
const journal=path.join(dir,'renames.json');fs.writeFileSync(journal,JSON.stringify(plan,null,2));
for(const entry of plan) {
  try {
    const projection=unwrap(await api.callUnary('session/projections',{sessionId:entry.sessionId}),'session.projections');
    if(!projection){entry.status='not-live';continue;}
    if(!isUnnamedTitle(projection.values?.title)){entry.status='already-named';continue;}
    const result=unwrap(await api.sessions.rename({sessionId:entry.sessionId,title:entry.after}),'session.rename');
    entry.after=result.title;entry.status='renamed';
  }catch(error){entry.status='failed';entry.error=String(error.message);}
  finally{fs.writeFileSync(journal,JSON.stringify(plan,null,2));}
}
const after=unwrap(await api.sessions.list({}),'session.list').items;
const remaining=after.filter(row=>isUnnamedTitle(row.projections?.values?.title));
console.log(JSON.stringify({total:rows.length,renamed:plan.filter(e=>e.status==='renamed').length,failed:plan.filter(e=>e.status==='failed').length,remaining:remaining.length,journal}));
if(remaining.length)process.exitCode=1;
