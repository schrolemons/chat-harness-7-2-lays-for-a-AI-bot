// Run existing offline regressions in an isolated checkout, never in production state.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFile} from 'node:child_process';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-plugin-regression-'));
const names=['test-wake-reasons.mjs','test-slang-component.mjs','test-relay-component.mjs','test-relay-intent.mjs','test-chat-style.mjs','test-memory-context.mjs','test-context-session.mjs','test-context-dynamics.mjs','test-context-lifecycle.mjs','test-context-runtime.mjs','test-role-card-component.mjs','test-admin-dev-component.mjs','test-memory-store.mjs','test-schedule-reminder.mjs','test-daily-worklog.mjs','test-inject-lab.mjs','test-token-usage.mjs','test-reply-wait.mjs','test-qq-model-view.mjs','test-qq-preset-contract.mjs','test-qq-mode-plugin.mjs','test-mux-reconnect.mjs','test-bridge-health.mjs','test-bridge-startup.mjs','test-plugin-contract.mjs','test-cost-policy.mjs','test-plugin-repairs.mjs','test-plugin-delivery.mjs','test-plugin-matrix.mjs','test-scheduler.mjs','test-restart-persistence.mjs','test-availability.mjs','test-notification-delivery.mjs','test-ustc-notifications.mjs','test-campus-grab.mjs','test-token-economy.mjs','test-issue-regressions.mjs','test-personal-core-library.mjs','test-personal-core-runtime.mjs','test-personal-core-migration.mjs','test-personal-core-index.mjs','test-personal-core-host.mjs'];
names.push('test-context-snapshot-contract.mjs','test-context-timeline.mjs','test-dialogue-sequence.mjs','test-chat-entry-guidance.mjs','test-context-processing.mjs','test-context-limits.mjs','test-context-settings.mjs','test-context-records.mjs','test-context-refill.mjs','test-context-refresh-http.mjs','test-context-assembly.mjs','test-context-composer.mjs','test-context-inspector.mjs','test-context-attribution.mjs','test-context-request-stages.mjs');
const results=[];
names.push('test-session-recovery.mjs','test-session-recovery-capability.mjs','test-session-recovery-bridge.mjs','test-session-recovery-console.mjs');
names.push('test-desktop-bug-notes.mjs');
names.push('test-chat-regression-guards.mjs');
names.push('test-cost-authority.mjs','test-cost-authority-ui.mjs','test-cost-optimization.mjs');
const outputArgument=process.argv.slice(2).find(argument=>argument.startsWith('--output='));
const outputFile=outputArgument?path.resolve(repo,outputArgument.slice('--output='.length)):path.join(repo,'state/plugin-audit-regressions.json');
names.push('test-profile-extraction-policy.mjs', 'test-read-receipts.mjs', 'test-whale-persona.mjs', 'test-role-card.mjs', 'test-task-isolation.mjs', 'test-task-tool-guard.mjs', 'test-session-concurrency.mjs', 'test-task-worker-persona.mjs');
names.push('test-resolved-send-plan.mjs','test-outbound-facts.mjs','test-outbound-host.mjs','test-outbound-migration.mjs');
names.push('test-message-ack-round-failure.mjs','test-message-ack-active-turn.mjs');
names.push('test-learning-mcp.mjs','test-learning-scopes.mjs','test-learning-routes.mjs','test-interest-learning.mjs','test-alias-learning.mjs','test-slang-learn.mjs');
names.push('test-context-assembly.mjs','test-context-composer.mjs','test-context-routes.mjs');
names.push('test-games-current.mjs','test-games-mcp.mjs');
names.push('test-context-knowledge.mjs','test-context-assembly.mjs','test-context-composer.mjs','test-context-routes.mjs','test-prompt-unicode.mjs','test-knowledge-quota-behavior.mjs','test-knowledge-quota-ingress.mjs','test-knowledge-quota-semantic.mjs','test-mood-lifecycle.mjs','test-mood-daily-recovery.mjs','test-mood-identity-style.mjs');
names.splice(0,names.length,...new Set(names));
const onlyArgument=process.argv.slice(2).find(argument=>argument.startsWith('--only='));
if(onlyArgument){const selected=new Set(onlyArgument.slice('--only='.length).split(','));if([...selected].some(name=>!names.includes(name)))throw Error('Unknown isolated audit test');names.splice(0,names.length,...names.filter(name=>selected.has(name)));}
try{
 for(const dir of ['src','scripts','plugins','dsh','roles','public','console','private-libraries','examples','docs'])if(fs.existsSync(path.join(repo,dir)))fs.cpSync(path.join(repo,dir),path.join(root,dir),{recursive:true,filter:file=>!['.git','node_modules','__pycache__'].includes(path.basename(file))});
 fs.copyFileSync(path.join(repo,'package.json'),path.join(root,'package.json'));fs.symlinkSync(path.join(repo,'node_modules'),path.join(root,'node_modules'),'junction');fs.mkdirSync(path.join(root,'state'));
 fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({dsh:{baseUrl:'http://127.0.0.1:1',authToken:'fixture-only',model:'deepseek-flash',reasoningEffort:'low'},ownerQQ:123,allow:{private:['123'],groups:['456']},consolePort:0,consoleToken:'fixture-console-token'}));
 let cursor=0;async function worker(){while(cursor<names.length){const name=names[cursor++],start=Date.now();const result=await new Promise(resolve=>execFile(process.execPath,['scripts/'+name],{cwd:root,timeout:['test-token-economy.mjs','test-plugin-matrix.mjs'].includes(name)?240000:90000,maxBuffer:2e6,windowsHide:true},(error,stdout,stderr)=>resolve({name,ok:!error,ms:Date.now()-start,...(error?{error:error.message,output:(stdout+'\n'+stderr).slice(-7000)}:{})})));results.push(result);console.log((result.ok?'PASS ':'FAIL ')+name);}}
 await Promise.all([worker(),worker(),worker()]);
 fs.mkdirSync(path.dirname(outputFile),{recursive:true});
 fs.writeFileSync(outputFile,JSON.stringify({generatedAt:new Date().toISOString(),passed:results.filter(r=>r.ok).length,total:results.length,results},null,2));
 for(const r of results.filter(r=>!r.ok))console.log(JSON.stringify(r));
 if(results.some(r=>!r.ok))process.exitCode=1;
}finally{if(path.dirname(root)!==os.tmpdir() || !path.basename(root).startsWith('qq-plugin-regression-'))throw Error('Unexpected cleanup path');fs.rmSync(root,{recursive:true,force:true});}
