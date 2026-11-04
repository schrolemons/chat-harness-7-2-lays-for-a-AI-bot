// Isolated plugin fixtures use the real central receipt ledger. The provided
// sender is a test double; no QQ, model or production state is accessed.
import path from 'node:path';
import {createDeliveryLedger} from '../../plugins/qq-components/life-scheduler/delivery-ledger.mjs';
export function withDiaryDelivery(root,capabilities,{now=Date.now}={}){
  if(capabilities.deliveryStatus)return capabilities;
  const ledger=createDeliveryLedger({file:path.join(root,'fixture-delivery-receipts.json'),now});
  return {runtimeStartedAt:0,...capabilities,deliveryStatus:id=>ledger.status(id),async sendDiaryDelivery(key,body,meta){
    const claimed=ledger.claim(meta);if(!claimed.ok)return {ok:false,reason:claimed.reason};
    const sender=capabilities.sendNotification||capabilities.sendSessionText;
    let sent=false;try{sent=typeof sender==='function'&&await sender(key,body,meta)===true;}catch{}
    ledger.finish(meta.id,sent);return {ok:sent,receiptStatus:sent?'sent':'uncertain'};
  }};
}
