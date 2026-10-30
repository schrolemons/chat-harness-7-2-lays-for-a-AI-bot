import {createHmac,timingSafeEqual} from 'node:crypto';
export const PACKET_HEADER='【小鲸鱼 context envelope v1】\n';
export function encodePacket(body,secret){const json=JSON.stringify(body);return PACKET_HEADER+JSON.stringify({body:json,signature:createHmac('sha256',secret).update(json).digest('hex')});}
export function decodePacket(text,secret,sessionId){
 try {
  if(typeof text!=='string'||!text.startsWith(PACKET_HEADER)||text.length>900000)return null;
  const {body,signature}=JSON.parse(text.slice(PACKET_HEADER.length));
  if(typeof body!=='string'||! /^[a-f0-9]{64}$/.test(signature))return null;
  const expected=createHmac('sha256',secret).update(body).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))return null;
  const packet=JSON.parse(body);
  if(packet.version!==1&&packet.version!==undefined)return null;
  if(packet.sessionId!==sessionId||!Array.isArray(packet.modules)||!packet.nonce||!Number.isFinite(packet.issuedAt)||packet.issuedAt>Date.now()+60000)return null;
  return packet;
 }catch{return null;}
}
export function redact(text){return String(text||'').replace(/(【会话令牌】\s*)[^\s（\n]+/g,'$1[已隐藏]').replace(/("(?:token|agentToken|apiKey|secret)"\s*:\s*")[^"\n]*(")/gi,'$1[已隐藏]$2').replace(/(\b(?:token|agentToken)\s*[=:]\s*["']?)[a-z0-9_\-.]{8,}/gi,'$1[已隐藏]');}
