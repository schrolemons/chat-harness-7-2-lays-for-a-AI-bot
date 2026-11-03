import fs from 'node:fs';
import {registerHooks} from 'node:module';

// DSH/pnpm can install the package without running our postinstall patch.
// Resolve the SDK's extensionless imports in memory; never edit shared dependencies.
const sdkBase=new URL('.',import.meta.resolve('@snowluma/sdk')).href;
const hook=registerHooks({resolve(specifier,context,nextResolve){
 try{return nextResolve(specifier,context);}
 catch(error){
  if(error.code!=='ERR_MODULE_NOT_FOUND'||!context.parentURL?.startsWith(sdkBase)
   ||!/^\.\.?\//.test(specifier))throw error;
  const candidate=new URL(specifier+'.js',context.parentURL);
  if(!candidate.href.startsWith(sdkBase)||!fs.existsSync(candidate))throw error;
  return nextResolve(candidate.href,context);
 }
}});
let sdk;
try{sdk=await import('@snowluma/sdk');}finally{hook.deregister();}
export const {SnowLumaWebSocketClient,text}=sdk;
