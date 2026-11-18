// Resolve only the current session's authenticated staged-image listing.
export function resolveStagedMessageImage(images,{messageId,imageIndex=1}={}){
 const id=String(messageId??'');
 if(!/^-?[1-9]\d*$/.test(id)||!Number.isSafeInteger(imageIndex)||imageIndex<1||imageIndex>5)throw Error('本次未发送：原图片消息ID或图片序号无效');
 const matches=(images||[]).filter(image=>image.source==='qq-incoming'&&String(image.sourceMessageId)===id&&image.sourceImageIndex===imageIndex);
 if(matches.length!==1||!matches[0].imageId)throw Error('本次未发送：该消息图片未缓存、已过期或引用不唯一；不要猜imageId');
 return matches[0].imageId;
}
export function imageDeliveryFailure(error){
 const message=String(error?.message||'未知错误');
 if(error?.knownFailed===true||error?.delivery==='not_sent'||/^本次未发送：/.test(message))return '图片未发送：'+message;
 if(error?.delivery==='partial')return '图片任务部分送达，请核对真实回执，不要整批重发：'+message;
 return '图片发送结果未知，请勿自动重试：'+message;
}
