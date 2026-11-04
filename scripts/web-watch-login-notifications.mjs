import fs from 'node:fs';import path from 'node:path';
import {sendWebWatchNotification} from './web-watch-notification-client.mjs';
import {resolveConsoleToken} from '../plugins/qq-components/obs-bridge-health/health.mjs';
export async function flushLoginNotices({root,recovery,send=sendWebWatchNotification,log=()=>{}}){
 const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8')),key='private:'+String(config.ownerQQ||'');
 if(!/^private:[1-9]\d*$/.test(key))return {ok:false,error:'未配置管理员QQ'};
 let count=0;
 for(const item of recovery.pendingNotices()){
  if(!recovery.pendingNotices().some(current=>current.id===item.id))continue;
  try{const accepted=await send({endpoint:'http://127.0.0.1:'+(config.consolePort||3100),consoleToken:resolveConsoleToken(root,config),key,items:[item],log});if(accepted!==true)throw Error('通知未受理');recovery.noticeResult(item.id,true);count++;}
  catch(error){recovery.noticeResult(item.id,false,error.message);log('登录协助QQ通知未受理：'+error.message);return {ok:false,count,error:error.message};}
 }
 return {ok:true,count};
}
