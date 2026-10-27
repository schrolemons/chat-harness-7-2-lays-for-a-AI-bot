import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function configure(options = {}, root = ROOT) {
  const file = path.join(root, 'config.json');
  if (fs.existsSync(file) && !options.update) throw Error('config.json already exists; use --update to preserve and amend it');
  const cfg = JSON.parse(fs.readFileSync(fs.existsSync(file) ? file : path.join(root, 'config.example.json'), 'utf8'));
  const owner = String(options.owner || cfg.ownerQQ || '');
  if (!/^[1-9]\d{4,11}$/.test(owner)) throw Error('请输入自己的管理员 QQ 号');
  const home = path.resolve(options.snowlumaDir || cfg.snowluma.homeDir || '');
  if (!fs.existsSync(path.join(home, 'index.mjs')) || !fs.existsSync(path.join(home, process.platform === 'win32' ? 'node.exe' : 'launcher.sh'))) throw Error('SnowLuma directory must contain its complete official release');
  cfg.ownerQQ = owner;
  if (!cfg.allow.private.includes(owner)) cfg.allow.private.push(owner);
  cfg.allowAllWhenEmpty = false;
  cfg.sessionCwd = root;
  cfg.snowluma.homeDir = home;
  cfg.snowluma.launcherPath = path.join(home, process.platform === 'win32' ? 'launcher.bat' : 'launcher.sh');
  if (process.env.SNOWLUMA_ACCESS_TOKEN) cfg.snowluma.accessToken = process.env.SNOWLUMA_ACCESS_TOKEN;
  if (options.dshUrl) { const url = new URL(options.dshUrl); if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw Error('Use a local DSH endpoint'); cfg.dsh.baseUrl = url.href.replace(/\/$/,''); }
  fs.writeFileSync(file, JSON.stringify(cfg,null,2)+'\n', { mode: 0o600 });
  fs.mkdirSync(path.join(root,'state'), {recursive:true,mode:0o700});
  for (const [name,value] of Object.entries({'current-role.json':{role:'小鲸鱼',mode:'active'},'mode.json':{mode:'reserved2',closedAgentPreset:''}})) {
    const target=path.join(root,'state',name);if(!fs.existsSync(target))fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  }
  return {configured:true,configFile:file};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),get=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
  try {
    let owner=get('--owner'),snowlumaDir=get('--snowluma-dir');
    if ((!owner||!snowlumaDir)&&!args.includes('--non-interactive')) { const rl=createInterface({input:process.stdin,output:process.stdout});try{owner ||= await rl.question('管理员 QQ（仅写入本机配置）：');snowlumaDir ||= await rl.question('SnowLuma 完整发行包解压目录：');}finally{rl.close();} }
    console.log(JSON.stringify(configure({owner,snowlumaDir,dshUrl:get('--dsh-url'),update:args.includes('--update')})));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
