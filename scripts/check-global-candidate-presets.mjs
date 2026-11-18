import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import yaml from 'js-yaml';
const root=JSON.parse(fs.readFileSync('workspace.local.json')).runtimeRoot,dir=path.join(root,'state/audits/global-model-inheritance-20261113');
const ids=['qq-chat','qq-chat-v2','qq-admin','qq-task-worker','qq-learning','qq-chat-dev'];
for(const id of ids){
 const file='plugins/qq-agent-presets/presets/'+id+'.patch.yml';
 const old=yaml.load(fs.readFileSync(path.join(dir,'before/runtime',file),'utf8'));
 const next=yaml.load(fs.readFileSync(file,'utf8'));
 const ordinary=data=>data[0].insert[0].config.plugins.filter(row=>row.id!=='compaction');
 assert.deepEqual(ordinary(next),ordinary(old),'A non-compaction preset change would regress current behavior: '+id);
 const group=next[0].insert[0].config.plugins.find(row=>row.id==='compaction');
 assert(group.config.some(row=>row.name==='qq-agent-presets/default-compaction.mjs'));
 assert(!group.config.some(row=>row.config?.summarizationProvider||row.config?.summarizationModel));
}
console.log(JSON.stringify({presets:ids.length,nonCompactionBehaviorPreserved:true,fixedSummaryRoutesRemoved:true}));
