import path from 'node:path';import {execFileSync} from 'node:child_process';
export function matchesMonitorBrowser(command,{profile,port}){
 const text=String(command||''),match=/"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=(\S+)/i.exec(text);
 const directory=match?.[1]||match?.[2]||match?.[3];
 return !!directory&&path.resolve(directory).toLowerCase()===path.resolve(profile).toLowerCase()&&Number(/--remote-debugging-port=(\d+)/.exec(text)?.[1])===Number(port);
}
export function isMonitorBrowser(browser,options){
 const args=browser.process?.()?.spawnargs;if(args&&matchesMonitorBrowser(args.map(x=>x.includes(' ')?'"'+x+'"':x).join(' '),options))return true;
 if(process.platform!=='win32')return false;
 try{const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Select-Object CommandLine | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:2*1024*1024});const rows=JSON.parse(output||'[]');return (Array.isArray(rows)?rows:[rows]).some(row=>matchesMonitorBrowser(row.CommandLine,options));}catch{return false;}
}
