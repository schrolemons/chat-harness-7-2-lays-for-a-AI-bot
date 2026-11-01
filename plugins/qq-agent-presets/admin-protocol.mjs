// Share the v2 interaction protocol, excluding its ordinary-user/local-tool ban.
export function adminPersonaPrefix(admin,v2) {
  const marker='【二代仿真模式 —— 工具协议';
  const index=String(v2).indexOf(marker);
  if(index<0)throw Error('二代预设缺少共享工具协议段');
  return String(admin).trim()+'\n\n'+String(v2).slice(index).trim();
}
