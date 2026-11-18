import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
import {unwrap} from './dsh-client.js';

// A disposable native session with the existing tool-free preset. It never
// enters the chat session map or receives an inbound/QQ authorization token.
export async function runReadOnlyWorker({api,prompt,content,title='后台资料整理',prepare,onCreated,onEvent,signal,timeoutMs=180000,WebSocketImpl=WebSocket}={}){
 const abort=new AbortController(),relay=()=>abort.abort(signal.reason||Error('Worker interrupted'));
 signal?.addEventListener('abort',relay,{once:true});if(signal?.aborted)relay();
 const timer=setTimeout(()=>abort.abort(Error('Read-only worker timed out')),timeoutMs);
 let sessionId,completed=false,unrecorded=false;
 try{
  const presets=unwrap(await api.agentPresets.list({},abort.signal),'worker presets').presets;
  const preset=api.sessionPolicy.resolvePreset('qq-memory-worker');
  if(!presets.some(p=>p.id===preset&&!p.broken))throw Error('Tool-free worker preset unavailable');
  const response=await api.sessions.create({agentPreset:'qq-memory-worker',title},abort.signal);
  sessionId=unwrap(response,'worker create').sessionId;unrecorded=response.ownership?.status==='unrecorded';
  await onCreated?.(sessionId);await prepare?.(sessionId);
  abort.signal.throwIfAborted();
  const url=new URL('/api/remote.mux',api.baseUrl);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  const text=await new Promise((resolve,reject)=>{
   const ws=new WebSocketImpl(url,{headers:{cookie:api.cookie}}),streamId=randomUUID();let submitted=false,done=false,answer='';
   const finish=(error)=>{if(done)return;done=true;abort.signal.removeEventListener('abort',onAbort);ws.close();error?reject(error):resolve(answer);};
   const onAbort=()=>finish(abort.signal.reason);abort.signal.addEventListener('abort',onAbort,{once:true});
   // Closing CONNECTING emits an error in ws. Install listeners before an
   // already-aborted signal can close the socket, and retain them on cleanup.
   ws.on('error',()=>finish(Error('Worker event connection failed')));
   ws.on('close',()=>{if(!done)finish(Error('Worker event connection closed'));});
   if(abort.signal.aborted){onAbort();return;}
   ws.on('open',()=>{if(!done)ws.send(JSON.stringify({type:'open',streamId,endpoint:'session/follow',payload:{args:{request:{address:{kind:'session',sessionId},maxMessages:1}}}}));});
   ws.on('message',bytes=>{let m;try{m=JSON.parse(String(bytes));}catch{return;}if(m.streamId!==streamId||done)return;
    if(m.type==='end'){finish(Error('Worker follow ended'));return;}if(m.type!=='item')return;
    if(m.value?.type==='snapshot'&&!submitted){submitted=true;void api.sessions.prompt({sessionId,mode:'queue',content:content||[{type:'text',text:prompt}]},abort.signal).then(r=>unwrap(r,'worker prompt')).catch(finish);return;}
    const event=m.value?.event;if(!event)return;
    try{onEvent?.(sessionId,event);}catch(error){finish(error);return;}
    if(event.type==='tool/call'||event.type==='request/header'&&event.data?.header?.tools?.length){finish(Error('Tool-free worker exposed or attempted a tool'));return;}
    if(event.type==='assistant/message')for(const b of event.data?.message?.content||[])if(b.type==='text')answer+=b.text;
    if(event.type==='turn/end')finish((event.data?.reason?.kind||event.data?.reason)==='completed'?null:Error('Worker turn incomplete'));
   });
  });completed=true;return {sessionId,text};
 }finally{
  clearTimeout(timer);signal?.removeEventListener('abort',relay);
  if(sessionId&&!completed)try{await api.sessions.cancel({sessionId});}catch{}
  if(sessionId&&!unrecorded)try{await api.callUnary('workspace/archiveSession',{sessionId});}catch{}
 }
}
