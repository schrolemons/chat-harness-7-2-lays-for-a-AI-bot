import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {waitForBridgeExit,stopBridgePair} from './start-da-feiyu.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function run(t,body,args=[]){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-start-check-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const fixture=path.join(dir,'fetch.mjs');fs.writeFileSync(fixture,body);
 return spawnSync(process.execPath,['--import',pathToFileURL(fixture).href,path.join(root,'scripts/start-da-feiyu.mjs'),...args],{cwd:root,encoding:'utf8',timeout:10000,windowsHide:true});
}
test('--check 对401只报诊断鉴权问题，不启动网关、扫描端口或改配置',t=>{
 const before=fs.readFileSync(path.join(root,'config.json'));
 const r=run(t,'globalThis.fetch=async()=>({ok:false,status:401});',['--check']);
 assert.equal(r.status,1);assert.match(r.stdout,/auth_required/);assert.doesNotMatch(r.stdout,/候选.*个地址|拉起|进程已启动/);assert.deepEqual(fs.readFileSync(path.join(root,'config.json')),before);
});
test('正常启动请求遇到健康已有实例直接结束，不启动第二个实例',t=>{
 const r=run(t,'globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({dshReady:true,snowluma:{connected:true,accountOnline:true,good:true,lastPacketAgoMs:100}})});');
 assert.equal(r.status,0);assert.match(r.stdout,/已健康运行/);assert.doesNotMatch(r.stdout,/候选.*个地址|进程已启动|拉起/);
});
test('网关已连接但上游退化不能误报已就绪，也不强制重启',t=>{
 const r=run(t,'globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({dshReady:true,snowluma:{connected:true,accountOnline:true,good:false,degraded:true}})});');
 assert.equal(r.status,1);assert.match(r.stdout,/upstream_degraded/);assert.doesNotMatch(r.stdout,/进程已启动|拉起|已就绪/);
});
test('--once 子进程退出不能安排五秒后自动重拉',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-once-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const fixture=path.join(dir,'once.mjs');
 const script=pathToFileURL(path.join(root,'scripts/start-da-feiyu.mjs')).href;
 // Reject the restart action itself; cold module import time is unrelated to --once semantics.
 fs.writeFileSync(fixture,'const {onChildExit}=await import('+JSON.stringify(script)+');globalThis.setTimeout=()=>{throw Error("UNEXPECTED_RESTART_TIMER")};onChildExit(1);console.log("ONCE_EXITED");');
 const r=spawnSync(process.execPath,[fixture,'--once'],{cwd:root,encoding:'utf8',timeout:10000,windowsHide:true});
 assert.equal(r.status,0,r.stderr||r.error?.message);assert.match(r.stdout,/ONCE_EXITED/);assert.doesNotMatch(r.stdout,/后重拉/);
});
test('--once 遇到已被信号结束的子进程立即返回，不等待已发出的exit事件',async()=>{
 const ended={exitCode:null,signalCode:'SIGTERM',once(){throw Error('must not wait for a past exit');}};
 assert.equal(await waitForBridgeExit(ended),false);
 assert.equal(await waitForBridgeExit({exitCode:0,signalCode:null}),true);
});

function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
async function detachedPair(t){
 const code=`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore',windowsHide:true});console.log(child.pid);setInterval(()=>{},1000);`;
 const parent=spawn(process.execPath,['-e',code],{stdio:['ignore','pipe','ignore'],windowsHide:true});
 let childPid=0;
 t.after(()=>{for(const pid of [parent.pid,childPid]){if(pid&&alive(pid))try{process.kill(pid);}catch{}}});
 const timeout=AbortSignal.timeout(5000);
 const [chunk]=await once(parent.stdout,'data',{signal:timeout});
 childPid=Number(String(chunk).trim());assert.ok(childPid>0);
 return {parent,childPid};
}

test('强制清理明确结束守护和独立桥接子进程',async t=>{
 const {parent,childPid}=await detachedPair(t);
 assert.equal(await stopBridgePair(childPid,parent.pid),true);
 assert.equal(alive(parent.pid),false);assert.equal(alive(childPid),false);
});

test('父进程已结束的独立桥接仍会被清理',async t=>{
 const {parent,childPid}=await detachedPair(t);
 const exited=once(parent,'exit');parent.kill();await exited;
 assert.equal(alive(childPid),true,'reproduce detached child surviving supervisor exit');
 assert.equal(await stopBridgePair(childPid,parent.pid),true);
 assert.equal(alive(childPid),false);
});
