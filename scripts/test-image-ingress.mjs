import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const harness = await bridgeHarness({ config: { allow: { private: ['123'], groups: ['456'] } } });
let server;
try {
  const raw=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQmcAAAAASUVORK5CYII=','base64');
  let fetched=0,release;harness.bot.getImage=async()=>{fetched++;return new Promise(resolve=>release=()=>resolve({data:raw.toString('base64')}));};
  harness.setMode('reserved2');
  await harness.handleIncoming('group', '456', {
    user_id: 222,
    group_id: 456,
    self_id: 999,
    message_id: 'friend-image-without-wake',
    message_seq: 100,
    message: [{ type: 'image', data: { file: 'fixture.png' } }],
    sender: { nickname: 'Group friend' }
  }, harness.cfg);

  assert.equal(harness.imageAssetStore.list({key:'group:456'}).length,0,'ingress must not wait for a pending image download');
  assert.match(harness.getSocialV2State('group:456').recentMessages.at(-1).text,/一张图片/);
  release();for(let n=0;n<20&&!harness.imageAssetStore.list({key:'group:456'}).length;n++)await new Promise(resolve=>setTimeout(resolve,10));
  const staged = harness.imageAssetStore.list({ key: 'group:456' });
  assert.equal(staged.length, 1);
  assert.equal(staged[0].source, 'qq-incoming');
  assert.match(staged[0].name, /^QQ暂存图片-1\.png$/);
  assert(harness.imageAssetStore.get({key:'group:456',imageId:staged[0].imageId}).image.data.equals(raw),'raw bytes are cached without model normalization');assert.equal(fetched,1);
  const incoming=harness.getSocialV2State('group:456').recentMessages.at(-1);
  assert.match(incoming.media[0]._imageSourceRef,/friend-image-without-wake/,'cache reference survives message persistence');
  harness.bot.getImage=async()=>{throw Error('on-demand viewing must reuse the local ingress cache');};
  const images=await harness.fetchMediaData(incoming.media,'group:456');
  assert.equal(images.length,1);assert.equal(images[0].mimeType,'image/png');assert.equal(images[0].data,raw.toString('base64'));
  assert.equal(fetched,1,'viewing a cached picture does not query QQ again');
  assert.equal(harness.calls.created.length, 0, 'image staging must not require a model wake');
  await harness.ensureSession('group:456');
  server=harness.startConsoleServer();if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port,token=harness.getSocialV2State('group:456').agentToken;
  const headers={'x-console-token':harness.cfg.consoleToken,'x-agent-token':token,Origin:base};
  const response=await fetch(base+'/api/images/message?key=group:456&messageId=friend-image-without-wake',{headers});
  assert.equal(response.status,200);assert.equal((await response.json()).images[0].data,raw.toString('base64'));
  delete incoming.media[0]._imageSourceRef;
  const legacy=await fetch(base+'/api/images/message?key=group:456&messageId=friend-image-without-wake',{headers});
  assert.equal(legacy.status,200);assert.equal((await legacy.json()).images[0].data,raw.toString('base64'),'legacy metadata resolves the exact persisted cache without another QQ download');
  const heldAsset=harness.imageAssetStore.stage({key:'group:456',source:'qq-incoming',sourceRef:'qq:budget-held-image:1',data:raw,ttlMs:3600000});
  const restored=await fetch(base+'/api/images/message?key=group:456&messageId=budget-held-image',{headers});
  assert.equal(restored.status,200);assert.equal((await restored.json()).images[0].data,raw.toString('base64'),'a held/recovered message can resolve its persisted raw-cache handle without replaying image data');
  const wrongSession=await fetch(base+'/api/images/message?key=private:123&messageId=friend-image-without-wake',{headers});
  assert.equal(wrongSession.status,403,'cached image reads keep the current-session token check');
  assert.equal(fetched,1);
  let analyzed=0;
  harness.taskCaps.readImageWithModel=async input=>{analyzed++;assert.equal(input.key,'group:456');return {text:JSON.stringify({observations:['图片1：测试像素'],uncertainties:[]})};};
  const viewed=await fetch(base+'/api/images/message?key=group:456&messageId=friend-image-without-wake&analyze=1&question=测试',{headers});
  assert.equal(viewed.status,200);const viewedData=await viewed.json();
  assert.equal(viewedData.analysis.observations[0],'图片1：测试像素');assert.equal(viewedData.images,undefined,'the text model must not receive binary image attachments');assert.equal(analyzed,1);assert.equal(fetched,1);
  const beforePrompts=harness.calls.prompts.length;
  const recovery=await harness.taskCaps.dispatchBudgetRecovery({key:'group:456',prompt:'恢复缓存图片消息',messages:[{
    id:'budget-held-image',kind:'group',at:Date.now(),atSelf:true,userId:'222',sender:'fixture',text:'看看这张图',imageIds:[heldAsset]
  }]});
  assert.equal(recovery.ok,true);assert.equal(harness.calls.prompts.length,beforePrompts+1);
  assert(!harness.calls.prompts.at(-1).content.some(part=>part.type==='image'),'recovery must not silently preload the image again');
  assert(harness.calls.prompts.at(-1).content.some(part=>part.type==='text'&&part.text.includes('一张图片，尚未分析')));
  console.log('group image ingress returns a placeholder before download, caches raw bytes in background, and does not wake DSH');
} finally {
  if(server)await new Promise(resolve=>server.close(resolve));
  await harness.close();
}
