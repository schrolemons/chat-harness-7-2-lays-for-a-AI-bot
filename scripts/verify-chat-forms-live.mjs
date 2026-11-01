// Real DSH preset/context consumer, isolated model sessions, no QQ credentials.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import {NodeApiClient,unwrap} from '../src/dsh-client.js';
import {selectRoleText} from '../src/role-card.js';
import {cleanRoleHint} from '../src/role-hint.js';
import {splitPromptUnicode} from '../src/prompt-unicode.js';
import {createPlugin} from '../plugins/qq-components/ctx-context-dynamics/index.js';
import {createPlugin as createChatStyle} from '../plugins/qq-components/ctx-chat-style/index.js';
import {encodePacket} from '../plugins/qq-components/obs-context-assembly/packet.mjs';
import {secretFor,readEvidence} from '../plugins/qq-components/obs-context-assembly/store.mjs';
import {assertGlobalBudgetAllowsModel} from '../plugins/qq-components/life-campus-watch/summarizer.mjs';
import {readCostPolicy,selectCostPolicy} from '../plugins/qq-components/obs-cost-policy/policy.mjs';
import {resolveConsoleToken} from '../plugins/qq-components/obs-bridge-health/health.mjs';

const root=process.cwd(),dir=path.join(root,'state/audits/receipt-voice-final-2026-10-31');
const cfg=JSON.parse(fs.readFileSync('config.json','utf8')),api=new NodeApiClient(cfg.dsh.baseUrl,8000,cfg.dsh.authToken?{token:cfg.dsh.authToken}:{});
const mood={...JSON.parse(fs.readFileSync('plugins/qq-components/ctx-user-mood/plugin.json','utf8')).config,...JSON.parse(fs.readFileSync('state/plugins/config/ctx-user-mood.json','utf8'))};
const role=cleanRoleHint(selectRoleText(fs.readFileSync('roles/AI助手.md','utf8'),'v2'));
const results=[],cases=[{mode:'normal',score:70,scope:'group',question:'不能玩小普通了。（在聊游戏，图中的小个子角色扛着一杆很大的枪）'},{mode:'normal',score:70,scope:'group',question:'。'},{mode:'normal',score:70,question:'今天真乖，给你一个抱抱。'},{mode:'critical',score:20,question:'你知道大海的样子，可是这算不算真的去过那里呀？'}];
fs.mkdirSync(dir,{recursive:true});
// This script tests the configured administrator's voice without QQ delivery.
// Respect the live owner exemption; never raise limits or borrow another scope.
async function checkBudget(){
 const response=await fetch('http://127.0.0.1:'+(cfg.consolePort||3100)+'/api/tokens/budgets',{headers:{'x-console-token':resolveConsoleToken(root,cfg)},signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw Error('Cannot verify live probe budget: '+response.status);
 const budget=await response.json();
 if(budget.owner?.key==='private:'+String(cfg.ownerQQ)&&budget.owner.budgetEnabled===false)return;
 await assertGlobalBudgetAllowsModel(root);
}
async function runTurn(sessionId,prompt){
 await api.ensureAuth();
 return new Promise((resolve,reject)=>{
  const socket=new WebSocket(cfg.dsh.baseUrl.replace(/^http/,'ws')+'/api/remote.mux',{headers:{cookie:api.cookie}}),streamId=randomUUID();
  let sent=false,finished=false,answer='',starter;
  const finish=(error)=>{if(finished)return;finished=true;clearTimeout(timer);clearTimeout(starter);socket.close();error?reject(error):resolve(answer);};
  const timer=setTimeout(()=>finish(Error('isolated voice turn timed out')),45000);
  const submit=()=>{if(sent||finished)return;sent=true;api.sessions.prompt({sessionId,mode:'queue',content:[{type:'text',text:prompt}]}).catch(finish);};
  socket.on('open',()=>{socket.send(JSON.stringify({type:'open',streamId,endpoint:'session/follow',payload:{args:{request:{address:{kind:'session',sessionId}}}}}));starter=setTimeout(submit,500);});
  socket.on('message',bytes=>{
   let row;try{row=JSON.parse(String(bytes));}catch{return;}if(row.streamId!==streamId||row.type!=='item')return;
   if(row.value?.type==='snapshot')submit();const e=row.value?.type==='event'?row.value.event:null;
   if(e?.type==='tool/call'){void api.stopSessionWork(sessionId).catch(()=>{});finish(Error('canary attempted a tool; no QQ credentials were provided'));}
   if(e?.type==='assistant/message')for(const block of e.data?.message?.content||[])if(block.type==='text')answer+=block.text;
   if(e?.type==='turn/end')finish((e.data?.reason?.kind||e.data?.reason)==='completed'?null:Error('canary turn did not complete'));
  });
  socket.on('error',()=>finish(Error('isolated event stream failed')));socket.on('close',()=>{if(!finished)finish(Error('isolated event stream closed'));});
 });
}
for(const item of cases){
 try{await checkBudget();}catch(error){fs.writeFileSync(path.join(dir,'live-forms.json'),JSON.stringify({at:new Date().toISOString(),isolated:true,qqDelivery:false,blocked:String(error.message),results},null,2));console.error('Real model probe blocked: '+error.message);process.exitCode=2;break;}let sessionId;
 try{
  sessionId=unwrap(await api.sessions.create({cwd:dir,agentPreset:'qq-chat-v2'}),'canary create').sessionId;
  const tier=selectCostPolicy(readCostPolicy(root),{reason:'maintenance'});
  unwrap(await api.sessions.selectModel({sessionId,provider:cfg.dsh.provider||'deepseek-official',model:tier.model,reasoningEffort:tier.reasoningEffort}),'canary model');
  const key=item.scope==='group'?'group:40002':'private:'+String(cfg.ownerQQ),blocks=[],styleBlocks=[],plugin=createPlugin({root,config:{},addPromptBlock:t=>blocks.push(...splitPromptUnicode(t))});
  const voice=mood[item.mode+'Style'];plugin.hooks.beforePrompt({key,reason:'private',moodState:{enabled:true,mode:item.mode,modeName:mood[item.mode+'Name'],score:item.score,styleInstruction:voice},stickerConfig:{enabled:false}});
  createChatStyle({config:{},addPromptBlock:t=>styleBlocks.push(t)}).hooks.beforePrompt({key,isPrivate:item.scope!=='group',isOwnerKey:item.scope!=='group',roleName:'AI助手',incomingText:item.question,moodState:{mode:item.mode}});
  const modules=[{id:'role-card',text:role},{id:'ctx-chat-style',text:styleBlocks.join('\n\n')},{id:'ctx-context-dynamics',text:blocks.join('\n\n'),chatExpression:plugin.services.chatExpression.current({key})},{id:'message-snapshot',text:JSON.stringify({messages:[{seq:1,time:Date.now(),sender:'隔离测试用户',text:item.question}],recent:[]})},{id:'wake-action',text:'隔离语气验收，不是真实QQ来信。直接输出拟回复的正文，不调用任何工具，不发送QQ，不查真实会话，不记录记忆，不解释测试流程。按系统当前形态与完整示范自然接话。'}];
  const prompt=encodePacket({version:1,key,sessionId,scene:item.scope||'private',nonce:randomUUID(),issuedAt:Date.now(),modules},secretFor(root));
  const answer=await runTurn(sessionId,prompt),request=readEvidence(root,sessionId,'request'),norm=s=>String(s||'').replace(/\s+/g,''),system=(request?.messages||[]).filter(m=>m.role==='system').map(m=>m.text||'').join('\n');
  const result={mode:item.mode,scope:item.scope||'private',name:mood[item.mode+'Name'],question:item.question,answer,chars:[...answer].length,sessionId,fullSelectedStyle:norm(system).includes(norm(voice)),otherStylePresent:norm(system).includes(norm(mood[item.mode==='normal'?'criticalStyle':'normalStyle'])),noQqCredentials:true,qualityFlags:[...(/\(￣▽￣\)|（笑）|\(笑\)/.test(answer)?['stock_suffix']:[]),...(item.question==='。'&&/还是|想说什么|心里一紧/.test(answer)?['punctuation_motive_guess']:[])]};
  results.push(result);console.log(JSON.stringify(result));
 }finally{if(sessionId){try{await api.stopSessionWork(sessionId);}catch{}try{await api.workspace.archiveSession({sessionId});}catch{}}fs.writeFileSync(path.join(dir,'live-forms.json'),JSON.stringify({at:new Date().toISOString(),isolated:true,qqDelivery:false,results},null,2));}
}
if(results.some(r=>!r.answer.trim()||!r.fullSelectedStyle||r.otherStylePresent||r.qualityFlags.length))process.exitCode=1;
