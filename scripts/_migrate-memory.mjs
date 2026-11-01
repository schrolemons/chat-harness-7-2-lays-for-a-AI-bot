import fs from 'node:fs';
const FILE = 'src/bridge.js';
const raw = fs.readFileSync(FILE, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let lines = raw.split(/\r?\n/);
const trim = (s) => s.trim();
const indent = (s) => s.match(/^ */)[0].length;
const log = [];

function removeBlock(startPred, label) {
  const start = lines.findIndex(startPred);
  if (start < 0) throw new Error('找不到 ' + label);
  let end = start;
  if (!trim(lines[start]).endsWith(';') && !trim(lines[start]).endsWith('}')) {
    end = start + 1;
    while (end < lines.length && trim(lines[end]) !== '}') end += 1;
    if (end < lines.length) end += 1; // include closing }
  }
  lines.splice(start, end - start + 1);
  log.push(label + ' removed ' + (end - start + 1) + ' lines');
}

// 轻量记忆两行
for (const pred of [
  (l) => trim(l).startsWith('const memoryText = formatMemoryV2(st);'),
  (l) => trim(l).startsWith('const memoryLine = memoryText')
]) {
  const i = lines.findIndex(pred);
  if (i < 0) throw new Error('找不到 memoryText/memoryLine');
  lines.splice(i, 1);
}
log.push('memoryText/memoryLine removed');

// 长期记忆块 / 中期记忆块
removeBlock((l) => trim(l).startsWith('let persistMemoryLine ='), 'persistMemoryLine');
removeBlock((l) => trim(l).startsWith('let midTermLine ='), 'midTermLine');

// base 去掉三个变量
{
  const idx = lines.findIndex((l) => trim(l).startsWith('const base = adminDevLine'));
  if (idx < 0) throw new Error('找不到 base');
  let line = lines[idx];
  for (const name of ['persistMemoryLine', 'midTermLine', 'memoryLine']) {
    const before = line;
    line = line.replace(new RegExp(' \\+ ' + name + '\\b', 'g'), '');
    if (line === before) throw new Error('base 缺少 ' + name);
  }
  lines[idx] = line;
  log.push('base pruned');
}

// payload 补记忆数据
{
  const idx = lines.findIndex((l) => trim(l).startsWith('isOwnerKey: isAdminDevKey(key),'));
  if (idx < 0) throw new Error('找不到 payload flags');
  const pad = ' '.repeat(indent(lines[idx]));
  lines.splice(idx + 1, 0,
    `${pad}persistentMemory: readPersistMemoryV2(key),`,
    `${pad}midTermText: readTaskNotesV2(key).trim(),`,
    `${pad}maxChars: Math.max(500, Number(cfg.socialV2?.persistentMemory?.maxChars) || 4000),`
  );
  log.push('payload memory data added');
}

fs.writeFileSync(FILE, lines.join(eol));
console.log(log.join('\n'));
