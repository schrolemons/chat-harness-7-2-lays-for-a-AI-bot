// One-time conversion. Live probability policy belongs to life-wake-reasons.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {GROUP_WAKE_DEFAULTS,groupNames,validateGroupWake} from '../../plugins/qq-components/life-wake-reasons/group-wake.mjs';
export const RETIRED_GROUP_WAKE_FIELDS=['defaultMode','recommendedProbability','recommendedKeywords','recommendedAtMention','recommendedNameMention','recommendedQuestion','recommendedPoke'];
export function planGroupWakeMigration(config={},override={}){
 const next=structuredClone(config),policy={...override},w=next.socialV2?.wake||{};
 const bools={groupAtBonus:'recommendedAtMention',groupNameBonus:'recommendedNameMention',groupQuestionBonus:'recommendedQuestion',groupPokeBonus:'recommendedPoke'};
 for(const [field,old] of Object.entries(bools))if(policy[field]===undefined)policy[field]=w[old]===false?0:GROUP_WAKE_DEFAULTS[field];
 if(policy.groupNames===undefined)policy.groupNames=groupNames(Array.isArray(w.recommendedKeywords)?w.recommendedKeywords.join(','):w.recommendedKeywords||'').join(', ');
 if(validateGroupWake(policy).length>0)throw Error('群聊唤醒参数无效，迁移已停止');
 for(const field of RETIRED_GROUP_WAKE_FIELDS)delete w[field];
 return {config:next,override:policy};
}
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const atomic=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.group-wake.tmp';fs.writeFileSync(temp,bytes,{mode:0o600});fs.renameSync(temp,file);};
export function migrateGroupWake(root){
 const marker=path.join(root,'state/migrations/group-wake-v1.json');
 let journal=fs.existsSync(marker)?JSON.parse(fs.readFileSync(marker,'utf8')):null;
 if(journal?.phase==='complete')return journal;
 if(!journal){
  const files=['config.json','state/plugins/config/life-wake-reasons.json'];
  const before=files.map(f=>fs.existsSync(path.join(root,f))?fs.readFileSync(path.join(root,f)):null);
  const planned=planGroupWakeMigration(before[0]?JSON.parse(before[0]):{},before[1]?JSON.parse(before[1]):{});
  const backup='state/migrations/group-wake-backup-'+Date.now();
  journal={version:1,phase:'prepared',backup,files:files.map((f,i)=>({path:f,before:before[i]?hash(before[i]):null,after:JSON.stringify(i?planned.override:planned.config,null,2)+'\n'}))};
  for(let i=0;i<files.length;i++)if(before[i])atomic(path.join(root,backup,files[i]),before[i]);
  atomic(marker,JSON.stringify(journal,null,2));
 }
 for(const item of journal.files){const file=path.join(root,item.path),current=fs.existsSync(file)?hash(fs.readFileSync(file)):null;if(current===hash(item.after))continue;if(current!==item.before)throw Error('群聊唤醒迁移发现并行配置更改：'+item.path);atomic(file,item.after);}
 const done={version:1,phase:'complete',backup:journal.backup,files:journal.files.map(f=>({path:f.path,before:f.before,after:hash(f.after)}))};atomic(marker,JSON.stringify(done,null,2));return done;
}
