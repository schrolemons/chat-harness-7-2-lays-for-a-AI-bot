const same=(a,b)=>a?.provider===b?.provider&&a?.model===b?.model&&(a?.reasoningEffort||'')===(b?.reasoningEffort||'');

// Native selectModel also changes the desktop default. Session routing must
// not turn a worker override into a new user-selected global configuration.
export function createPreservingModelSelector({readDefault,writeDefault,selectModel,settleTimeoutMs=1000,pollIntervalMs=25}){
 let serial=Promise.resolve();
 return selection=>{
  const work=serial.then(async()=>{
   const before=await readDefault();
   let result,selectionError;
   try{result=await selectModel(selection);}catch(error){selectionError=error;}
   const selected=result?.selected||selection;
   let after=await readDefault();
   // Native selectModel resolves before its queued profile write commits.
   // Wait only while the exact prior revision and value remain unchanged;
   // any intervening user choice ends observation and is never overwritten.
   const deadline=Date.now()+settleTimeoutMs;
   while(!same(before.value,selected)&&same(before.value,after.value)&&after.revision===before.revision&&Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,pollIntervalMs));
    after=await readDefault();
   }
   if(!same(before.value,after.value)&&same(after.value,selected)&&after.revision===before.revision+1){
    try{await writeDefault(before.value,after.revision);}
    catch(error){
     // A real user may choose a new default between our read and CAS restore.
     // Never overwrite that newer choice or retry it as the worker's default.
     if((await readDefault()).revision===after.revision)throw error;
    }
   }
   if(selectionError)throw selectionError;
   return result;
  });
  serial=work.catch(()=>{});return work;
 };
}
