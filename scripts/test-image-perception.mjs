import test from 'node:test';import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/exec-image-perception/index.js';
const images=[{mimeType:'image/png',data:'fixture-bytes',text:'静态图'}];
const answer={text:JSON.stringify({observations:['图片1：红色圆形'],uncertainties:[]})};
test('on-demand perception is idle until requested, scoped, deduplicated and only returns observed text',async()=>{
 let calls=0,release;const inputs=[],plugin=createPlugin({config:{},capabilities:{readImageWithModel:async p=>{calls++;inputs.push(p);return new Promise(r=>release=r);}}});
 assert.equal(calls,0);const describe=plugin.services.imagePerception.describe;
 const a=describe({key:'private:123',messageId:'1',images}),b=describe({key:'private:123',messageId:'2',images});
 assert.equal(calls,1);assert.equal(inputs[0].selection.provider,'ustc');assert.equal(inputs[0].selection.reasoningEffort,'off');
 assert.equal(inputs[0].token,undefined);release(answer);const results=await Promise.all([a,b]);
 assert.equal(results[0].ok,true);assert.equal(results[1].messageId,'2');assert(!results[0].images);assert.match(results[0].observations[0],/红色圆形/);
 assert.equal((await describe({key:'private:123',messageId:'3',images})).cached,true);assert.equal(calls,1);
 assert.equal((await describe({key:'bad',messageId:'1',images})).ok,false);
 const other=describe({key:'group:123',messageId:'1',images});assert.equal(calls,2);release(answer);assert.equal((await other).cached,undefined);
});
test('failed or invented result formats do not become an image description',async()=>{
 for(const value of ['不是完整JSON',JSON.stringify({observations:[],uncertainties:[]}),JSON.stringify({observations:['猫'],uncertainties:'猜测'})]){
  const p=createPlugin({capabilities:{readImageWithModel:async()=>({text:value})}});
  const result=await p.services.imagePerception.describe({key:'private:123',messageId:'1',images});assert.equal(result.ok,false);assert(!result.observations);
 }
});
test('later observations answering the current question survive the image-count limit',async()=>{
 const observations=['标题','合作人数','项目主题','课程产出：过程报告、用户指南、个人反思','评估方式：100%课业，无期末考试'];
 const p=createPlugin({capabilities:{readImageWithModel:async()=>({text:JSON.stringify({observations,uncertainties:[]})})}});
 const result=await p.services.imagePerception.describe({key:'group:123',messageId:'1',images,question:'课程产出与评估方式'});
 assert.equal(result.ok,true);assert.deepEqual(result.observations,observations);
});
