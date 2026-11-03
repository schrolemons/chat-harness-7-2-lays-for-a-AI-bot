import path from 'node:path';

/** Runtime's immutable launch snapshot. No filesystem discovery, environment
 * fallback, token healing or configuration writeback in the owned path. */
export function bindInstanceSnowConfig(cfg,{root,active,env=process.env}={}){
  if(!active)return cfg;
  let selected;
  try{selected=JSON.parse(env.QQ_BRIDGE_SNOW_CONFIG);}catch{throw Error('OWNED_SNOW_CONFIG_REQUIRED');}
  const managed=path.join(root,'managed-dependencies'),relative=path.relative(managed,selected?.home||'');
  const endpoint=(value,protocol)=>{try{const u=new URL(value);return u.protocol===protocol&&u.hostname==='127.0.0.1'&&!u.username&&!u.password&&u.port&&Number(u.port)<=65535&&u.pathname==='/'&&!u.search&&!u.hash;}catch{return false;}};
  if(!path.isAbsolute(selected?.home||'')||!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)
    ||!/^[1-9]\d{4,19}$/.test(selected.botUin)||String(cfg.snowluma?.botUin)!==selected.botUin
    ||typeof selected.accessToken!=='string'||String(cfg.snowluma?.accessToken||'')!==selected.accessToken
    ||!endpoint(selected.httpUrl,'http:')||!endpoint(selected.wsUrl,'ws:')||!Number.isInteger(selected.consolePort)||selected.consolePort<1||selected.consolePort>65535)throw Error('OWNED_SNOW_CONFIG_INVALID');
  const snowluma={...cfg.snowluma,homeDir:selected.home,botUin:selected.botUin,httpUrl:selected.httpUrl,wsUrl:selected.wsUrl,accessToken:selected.accessToken,followDiscoveredEndpoint:false};
  delete snowluma.launcherPath;
  return {...cfg,consolePort:selected.consolePort,snowluma};
}
