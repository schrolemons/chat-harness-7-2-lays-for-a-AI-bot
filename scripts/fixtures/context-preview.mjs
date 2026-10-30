import {injectionReport} from '../../plugins/qq-components/learning-scopes.mjs';
import {createPlugin} from '../../plugins/qq-components/obs-context-assembly/index.js';
import {normalizePolicy,compileModules} from '../../plugins/qq-components/obs-context-assembly/policy.mjs';
import {writeJson,policyFile,recordEvidence,readEvidence} from '../../plugins/qq-components/obs-context-assembly/store.mjs';
export function createContextPreviewFixture(root){
 const reports={slang:injectionReport([{id:'s',content:'示例词',meaning:'表达惊讶',status:'confirmed',sourceKeys:['private:20012']}],'slang','private:20012',8),terms:injectionReport([{id:'t',term:'示例词条',summary:'示例释义',status:'confirmed',sourceKeys:['private:20012']}],'term','private:20012',3),aliases:injectionReport([],'alias','private:20012',40)};
 const service=createPlugin({root,callService:name=>reports[name]}).services.contextAssembly;
 const modules=[{id:'role-card',name:'当前角色设定',source:'C · 人格与角色',text:'演示角色：好奇、友善，遵守互动边界。'},
 {id:'session-background',name:'当前会话的固定背景',source:'C · 会话背景',text:''},
 {id:'ctx-memory-context',name:'当前记忆与事务',source:'C · 上下文与记忆',text:''},
 {id:'ctx-context-dynamics',name:'当前心情与双形态',source:'C · 心情管理',text:'心情 60 / 100；普通状态。'},
 {id:'slang-context',name:'当前会话黑话',source:'C · 黑话词库',text:'示例词：表达惊讶。'},
 {id:'tool-injection-lab',name:'提示词演练',source:'T · 提示词注入实验室',text:'仅演练触发时提供，不在冒泡常驻。'},
 {id:'message-snapshot',name:'本轮消息与收件状态',source:'桥接 · 消息窗口',text:'{"messages":[],"unreadCount":0}',protected:true},
 {id:'wake-action',name:'本轮唤醒任务',source:'L · 定时冒泡',text:'根据会话背景询问近况，不重复追问。',protected:true}];
 recordEvidence(root,'fixture-session','consumer',{sessionId:'fixture-session',pid:process.pid,at:Date.now()});
 service.compose({key:'private:20012',sessionId:'fixture-session',scene:'timeBubble',modules,fallback:'演示上下文'});
 recordEvidence(root,'fixture-session','request',{requestId:'fixture-initial',requestInRound:1,sessionId:'fixture-session',key:'private:20012',at:Date.now(),scene:'timeBubble',moduleEvidenceVersion:1,nonce:service.inspect({key:'private:20012'}).capture.nonce,modules:service.inspect({key:'private:20012'}).capture.modules.map(row=>({...row,inRequest:row.included})),messages:[{id:'actual-system',role:'system',name:'system 1',source:'DSH 框架与固定设定',text:'演示权限边界与重要角色设定。',chars:20},{id:'actual-user',role:'user',contextNonce:service.inspect({key:'private:20012'}).capture.nonce,name:'user 2',source:'qq-context-current',text:'演示当前上下文 <literal-data>，非可执行 HTML。',chars:40}],messageChars:60,toolCount:2,toolChars:360,tools:[{name:'qq_send_message',chars:200},{name:'qq_mark_read',chars:160}]});
 const {recentRequests:_history,requestStages:_stages,initialRequest:_initial,...first}=readEvidence(root,'fixture-session','request');
 for(let i=2;i<=3;i++)recordEvidence(root,'fixture-session','request',{...first,requestId:'fixture-'+i,requestInRound:i,at:first.at+i,tools:[{name:'qq_schedule',description:i===2?'query':'query by date',chars:200},{name:'qq_mark_read',chars:160}]});
 return {callService(_service,method,input){return service[method](input);},setConfig(id,policy){writeJson(policyFile(root),normalizePolicy(policy));return {ok:true,id,config:policy};},async reload(){}};
}
