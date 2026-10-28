// Parse Windows command-line quoting without depending on an executable's name.
function windowsArgs(command) {
  const args = [];
  let word = '', quoted = false, active = false;
  for (let i = 0; i < command.length; i++) {
    let char = command[i];
    if (char === '\\') {
      let count = 1;
      while (command[i + 1] === '\\') { count++; i++; }
      if (command[i + 1] === '"') {
        word += '\\'.repeat(Math.floor(count / 2));
        i++;
        if (count % 2) word += '"'; else quoted = !quoted;
      } else word += '\\'.repeat(count);
      active = true;
    } else if (char === '"') { quoted = !quoted; active = true; }
    else if (/\s/.test(char) && !quoted) {
      if (active) { args.push(word); word = ''; active = false; }
    } else { word += char; active = true; }
  }
  if (active) args.push(word);
  return args;
}

export function processRunsFile(command, file) {
  const args = windowsArgs(String(command || ''));
  const normalized = value => String(value).replaceAll('\\', '/').toLowerCase();
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (['-e', '--eval', '-p', '--print', '-Command', '-File'].includes(arg)) return false;
    if (['--import', '--require', '-r', '--loader', '--experimental-loader'].includes(arg)) { i++; continue; }
    if (arg === '--') return normalized(args[i + 1]) === normalized(file);
    if (arg.startsWith('--')) continue;
    if (arg.startsWith('-')) return false;
    return normalized(arg) === normalized(file);
  }
  return false;
}

export async function stopVerifiedRecords(records, { list, stop }) {
  for (const expected of records) {
    const current = (await list()).find(p => p.ProcessId === expected.ProcessId);
    if (!current) continue;
    if (!expected.CreationDate || String(expected.CreationDate) !== String(current.CreationDate)
      || current.CommandLine !== expected.CommandLine) continue;
    if (!(await stop(Number(current.ProcessId)))) throw new Error('目标进程未能停止，已取消后续启动');
  }
}
