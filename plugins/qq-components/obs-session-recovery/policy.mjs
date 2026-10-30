import {createHash} from 'node:crypto';
const MINUTE=60_000,DAY=24*60*MINUTE;
export function recoveryConfig(config={}){
 return {consecutiveFailures:Math.max(3,Math.min(10,Number(config.consecutiveFailures)||3)),minFailureSeconds:Math.max(120,Math.min(1800,Number(config.minFailureSeconds)||120)),cooldownMinutes:Math.max(30,Math.min(1440,Number(config.cooldownMinutes)||30)),maxRecoveriesPerDay:Math.max(1,Math.min(2,Number(config.maxRecoveriesPerDay)||2))};
}
function signature(failure){
 if(!failure)return null;
 const code=String(failure.code||''),status=Number(failure.status),message=String(failure.message||'');
 if(/quota|balance|credit|rate.?limit|auth|credential|invalid.*token|token.*invalid|expired.*token|token.*expired|access.?token|bearer|额度|余额|限额|鉴权|令牌/i.test(code+' '+message))return null;
 if(![400,422].includes(status)||!['INVALID_REQUEST','CONTEXT_WINDOW_EXCEEDED','INVALID_REPLAY'].includes(code))return null;
 return code+':'+status+':'+createHash('sha256').update(message.replace(/[a-f0-9-]{16,}/gi,'#').replace(/\b\d+\b/g,'#')).digest('hex').slice(0,12);
}
export function observeRecovery(previous={},event,config={}){
 if(!/^group:[1-9]\d*$/.test(String(event.key||''))||!event.sessionId)return previous;
 const now=Number(event.now)||Date.now(),same=previous.sessionId===event.sessionId;
 let record=same?{...previous}:{sessionId:event.sessionId,failures:[],attempts:previous.attempts||[],blocked:previous.blocked===true};
 if(record.recovering){
  if(event.progress===true)return {...record,interruptedByProgress:true,lastSeq:event.seq,failures:[],failureStartedAt:null,lastProgressAt:now};
  return record;
 }
 if(Number.isSafeInteger(event.seq)&&same&&Number.isSafeInteger(record.lastSeq)&&event.seq<=record.lastSeq)return record;
 if(Number.isSafeInteger(event.seq))record.lastSeq=event.seq;
 if(event.type==='turn/start'){record.turn={id:event.turn,chat:event.chatTurn===true,progress:false};return record;}
 if(event.progress===true){record.failures=[];record.failureStartedAt=null;record.turn={id:event.turn,chat:event.chatTurn===true,progress:true};record.awaitingRecovery=false;record.blocked=false;record.alertPending=false;record.blockReason='';record.lastProgressAt=now;return record;}
 if(event.type!=='turn/end')return record;
 const turn=record.turn;record.turn=null;
 const fingerprint=signature(event.failure);
 if(!turn||turn.id!==event.turn||!turn.chat||event.chatTurn!==true||turn.progress||!fingerprint){record.failures=[];record.failureStartedAt=null;return record;}
 if(record.awaitingRecovery){record.blocked=true;record.alertPending=true;record.blockReason='恢复后的新会话仍然发生模型请求错误';return record;}
 const window=Math.max(15*MINUTE,recoveryConfig(config).minFailureSeconds*1000*2);
 const previousFailure=record.failures?.at(-1);
 record.failureStartedAt=previousFailure?.signature===fingerprint&&now-previousFailure.at<=window?(record.failureStartedAt??record.failures[0].at):now;
 const failures=(record.failures||[]).filter(f=>now-f.at<=window&&f.signature===fingerprint&&f.turn!==event.turn);
 record.failures=[...failures,{turn:event.turn,at:now,signature:fingerprint}].slice(-10);
 return record;
}
export function recoveryDecision(record,snapshot,now=Date.now(),config={}){
 const cfg=recoveryConfig(config),deny=reason=>({recover:false,reason});
 if(record.blocked||record.recovering)return deny('已停手或正在恢复');
 if(!snapshot||snapshot.sessionId!==record.sessionId)return deny('会话已变化或状态不可用');
 if(snapshot.allowed!==true||snapshot.transportReady!==true||snapshot.budgetStage!=='normal'||snapshot.pendingCount<1||snapshot.busy!==false||snapshot.quiet!==false||snapshot.muted!==false||snapshot.paused!==false)return deny('额度、等待、权限、免打扰或连接条件不允许');
 const failures=record.failures||[],first=failures[0],last=failures.at(-1);
 if(failures.length<cfg.consecutiveFailures||!first||!last)return deny('失败次数不足');
 if(last.at-(record.failureStartedAt??first.at)<cfg.minFailureSeconds*1000||now-last.at>Math.max(15*MINUTE,cfg.minFailureSeconds*2000))return deny('失败跨度不足或证据已过期');
 const attempts=(record.attempts||[]).filter(at=>now-at<DAY);
 if(attempts.length>=cfg.maxRecoveriesPerDay||attempts.some(at=>now-at<cfg.cooldownMinutes*MINUTE))return deny('恢复冷却或每日上限');
 return {recover:true,reason:last.signature};
}
