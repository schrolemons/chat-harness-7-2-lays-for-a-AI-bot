import test from 'node:test';import assert from 'node:assert/strict';
import {createPlugin as perception} from '../plugins/qq-components/exec-image-perception/index.js';
import {createPlugin as replyShape} from '../plugins/qq-components/ctx-chat-reply-shape/index.js';
const key='group:456',message={seq:1,messageId:'101',userId:'222',text:'[一张图片]',bodyComplete:true,media:[{kind:'image'}]};
const image={index:1,mimeType:'image/jpeg',data:'fixture',text:'动图 3 帧/1.8s，已抽 3 帧拼成 3×1 网格，行优先 左上→右下'};
const answer={text:JSON.stringify({observations:['图片1：背景依次由红色变为蓝色、绿色'],uncertainties:[]})};
function fixture(read=async()=>answer){
 const vision=perception({config:{},capabilities:{readImageWithModel:read}});let data={};
 const shape=replyShape({config:{},state:{get:()=>structuredClone(data),set:p=>data={...data,...structuredClone(p)}},callService:(s,m,p)=>s==='imagePerception'?vision.services.imagePerception[m]?.(p):null});
 return {vision,svc:shape.services.replyPlan};
}
test('quoting an image requires successful analysis of that exact image before content binding',async()=>{
 const {vision,svc}=fixture(),plan=svc.resolve({key,turnId:'test',messages:[message]});
 const bind=()=>svc.bindContent({key,plan,messages:[message],replyToMessageId:'101'});
 assert.equal(bind().reason,'image_reply_requires_analysis');
 await vision.services.imagePerception.describe({key,messageId:'different',images:[image]});assert.equal(bind().ok,false);
 await vision.services.imagePerception.describe({key:'group:999',messageId:'101',images:[image]});assert.equal(bind().ok,false);
 await vision.services.imagePerception.describe({key,messageId:'101',images:[image]});assert.equal(bind().ok,true);
});
test('failed analysis and missing images cannot unlock a quoted image; unquoted text stays selective',async()=>{
 const {vision,svc}=fixture(async()=>{throw Error('fixture failure');}),plan=svc.resolve({key,messages:[message]});
 assert.equal(svc.bindContent({key,plan,messages:[message]}).ok,true);
 await vision.services.imagePerception.describe({key,messageId:'101',images:[image]});
 assert.equal(svc.bindContent({key,plan,messages:[message],replyToMessageId:'101'}).reason,'image_reply_requires_analysis');
});
test('animation preprocessing notes are part of vision cache identity and reach the model unchanged',async()=>{
 let calls=0;const seen=[],{vision}=fixture(async p=>{calls++;seen.push(p);return answer;});
 await vision.services.imagePerception.describe({key,messageId:'101',images:[{...image,text:'静态图'}]});
 await vision.services.imagePerception.describe({key,messageId:'101',images:[image]});
 assert.equal(calls,2);assert.equal(seen[1].images[0].text,image.text);assert.match(seen[1].prompt,/采样帧/);
});
test('all five images are analyzed in bounded batches instead of silently dropping the last two',async()=>{
 const batches=[],{vision}=fixture(async p=>{batches.push(p.images);return answer;});
 const images=Array.from({length:5},(_,i)=>({...image,index:i+1,data:'fixture-'+i}));
 const result=await vision.services.imagePerception.describe({key,messageId:'101',images});
 assert.equal(result.ok,true);assert.deepEqual(batches.map(x=>x.length),[3,2]);
 assert.deepEqual(vision.services.imagePerception.evidence({key,messageId:'101'}).indices,[1,2,3,4,5]);
});
test('local seq aliases map to the original QQ message ID without analyzing on ingress',async()=>{
 let calls=0;const {vision,svc}=fixture(async()=>{calls++;return answer;}),plan=svc.resolve({key,messages:[message]});
 assert.equal(typeof vision.hooks?.beforePrompt,'function');vision.hooks.beforePrompt({key,st:{recentMessages:[message],unread:[]}});assert.equal(calls,0);
 await vision.services.imagePerception.describe({key,messageId:'1',images:[image]});
 assert.equal(svc.bindContent({key,plan,messages:[message],replyToMessageId:'101'}).ok,true);
});
test('a reply to a user quoting an old image requires the original image evidence too',async()=>{
 const {vision,svc}=fixture(),followup={seq:2,messageId:'102',text:'这是什么？',bodyComplete:true,quote:{messageId:'101',text:'[一张图片]'}};
 const plan=svc.resolve({key,messages:[followup]});
 vision.hooks.beforePrompt({key,st:{recentMessages:[message,followup],unread:[followup]}});
 const bind=()=>svc.bindContent({key,plan,messages:[followup],replyToMessageId:'102'});
 assert.equal(bind().reason,'image_reply_requires_analysis');
 await vision.services.imagePerception.describe({key,messageId:'101',images:[image]});assert.equal(bind().ok,true);
});
