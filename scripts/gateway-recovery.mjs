// Missing gateway processes are recoverable. Quiet chats and upstream health
// warnings are not evidence that a process should be restarted.
export function createGatewayRecovery({inspect,recover,now=Date.now,cooldownMs=30000,maxAttempts=3,windowMs=600000,onError=()=>{}}) {
  let active=null,disposed=false,lastAttempt=-Infinity,attempts=[];
  async function check(){
    try {
      const state=await inspect();
      if(disposed||!state.bridgeRunning||!state.configured||!state.qqRunning||state.gatewayRunning||state.http||state.ws)return;
      const at=now();attempts=attempts.filter(time=>at-time<windowMs);
      if(at-lastAttempt<cooldownMs||attempts.length>=maxAttempts)return;
      lastAttempt=at;attempts.push(at);
      await recover();
    }catch(error){if(!disposed)onError(error);}
  }
  return {tick(){if(disposed)return Promise.resolve();if(active)return active;active=check().finally(()=>{active=null;});return active;},dispose(){disposed=true;}};
}
