import test from'node:test';import assert from'node:assert/strict';import{resolveStagedMessageImage,imageDeliveryFailure}from'../src/mcp-image-handle.mjs';
test('a quoted image resolves by exact original QQ message and position, never by the newest picture',()=>{
 const images=[{imageId:'newer',source:'qq-incoming',sourceMessageId:'-2',sourceImageIndex:1},{imageId:'quoted',source:'qq-incoming',sourceMessageId:'-1',sourceImageIndex:1},{imageId:'other-part',source:'qq-incoming',sourceMessageId:'-1',sourceImageIndex:2}];
 assert.equal(resolveStagedMessageImage(images,{messageId:'-1'}),'quoted');assert.equal(resolveStagedMessageImage(images,{messageId:-1,imageIndex:2}),'other-part');
 assert.throws(()=>resolveStagedMessageImage([],{messageId:'-1'}),/未缓存/);assert.throws(()=>resolveStagedMessageImage(images,{messageId:'0'}),/无效/);
 assert.throws(()=>resolveStagedMessageImage([...images,images[1]],{messageId:'-1'}),/不唯一/);
});
test('known refusals, partial delivery and unknown network results remain different',()=>{
 assert.match(imageDeliveryFailure({message:'task_group_pending',delivery:'not_sent'}),/^图片未发送/);
 assert.match(imageDeliveryFailure({message:'部分送达',delivery:'partial'}),/^图片任务部分送达/);
 assert.match(imageDeliveryFailure(Error('timeout')),/结果未知/);
});
