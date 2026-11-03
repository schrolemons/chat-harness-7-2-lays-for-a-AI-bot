const local = host => ['localhost','127.0.0.1','[::1]'].includes(host);
function url(value) {
 const parsed=new URL(value);
 if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error('OWNED_DSH_TARGET_INVALID');
 return parsed;
}
/** Only the owned controller calls this. Ordinary clients keep their explicit URL. */
export function followsNativeDsh(cfg) {
 const override=cfg.launcher?.ports?.dsh;
 if(override==='')return true;
 if(override!==undefined)return false;
 if(!cfg.dsh?.baseUrl)return true;
 const parsed=url(cfg.dsh.baseUrl);
 return parsed.protocol==='http:'&&local(parsed.hostname)&&parsed.pathname==='/'&&!parsed.search&&!parsed.hash;
}
export function selectInstanceDshTarget(cfg,getOrigin) {
 if(followsNativeDsh(cfg)) {
  if(typeof getOrigin!=='function')throw Error('NATIVE_DSH_TARGET_REQUIRED');
  const baseUrl=getOrigin();url(baseUrl);return {mode:'native',baseUrl};
 }
 let baseUrl=cfg.dsh?.baseUrl;
 const port=cfg.launcher?.ports?.dsh;
 const parsed=baseUrl?url(baseUrl):null;
 if(!parsed || (local(parsed.hostname)&&parsed.protocol==='http:'&&parsed.pathname==='/'&&!parsed.search&&!parsed.hash&&port!==undefined&&Number(parsed.port||80)!==Number(port)))baseUrl=`http://127.0.0.1:${port}`;
 url(baseUrl);return {mode:'explicit',baseUrl};
}
export function bindInstanceDshConfig(cfg,{active,env=process.env}={}) {
 if(!active)return cfg;
 let target;try{target=JSON.parse(env.QQ_BRIDGE_DSH_TARGET);url(target.baseUrl);}catch{throw Error('OWNED_DSH_TARGET_REQUIRED');}
 return {...cfg,dsh:{...cfg.dsh,baseUrl:target.baseUrl}};
}
export function instanceDshEnvironment(descriptor,env={}) {
 // Empty overrides also suppress the native MCP host's ambient environment merge.
 return {...env,DSH_HOME:descriptor.dshHome,DSH_LAUNCH_TOKEN:'',DSH_BASE_URL:'',DSH_URL:''};
}
