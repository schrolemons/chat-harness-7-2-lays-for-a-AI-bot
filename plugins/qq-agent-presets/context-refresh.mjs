import fs from 'node:fs';import path from 'node:path';
import {decodePacket} from '../qq-components/obs-context-assembly/packet.mjs';

// Trusted preset transport only: no console credential enters a model request.
export async function refreshContextPacket({root,sessionId,envelope,secret,signal}){
 const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
 const port=Number(config.consolePort??3100);
 if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('无效本机控制台端口');
 const response=await fetch('http://127.0.0.1:'+port+'/api/context/refresh',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId,envelope}),
  signal:signal?AbortSignal.any([signal,AbortSignal.timeout(2000)]):AbortSignal.timeout(2000),
 });
 if(!response.ok)throw Error('context refresh HTTP '+response.status);
 const result=await response.json(),packet=decodePacket(result.envelope,secret,sessionId),original=decodePacket(envelope,secret,sessionId);
 if(!packet||!original||packet.nonce!==original.nonce||packet.key!==original.key)throw Error('刷新响应与原会话/批次不符');
 return packet;
}
