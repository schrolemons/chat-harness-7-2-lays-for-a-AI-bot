// tool-user-checking（C 层｜自查 + 桌面便签）
//
// 机主原话：新增一个 tools，user-checking，开启后允许 bot 在无主动授权下查看系统运行和状态，
// 并在桌面追加一个有命名的 txt，写入它想说的话。权限**仅限**「读系统状态」和「追加 txt」。
//
// 所以这里刻意做窄：
//   · action=status：只读。os 层面的负载/内存/磁盘/进程指标，不扫进程、不看网络、不读文件内容；
//   · action=note  ：只在桌面**追加**一行，永远不覆盖、不删除、不改名、不能指定别的目录；
//   · 两个动作都被 config.enabled 总开关挡着，控制台关掉即失效；
//   · 提示词只注入边界说明（能做什么/不能做什么），不教它去探别人隐私。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_STATUS_CHARS = 1200;

function gb(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '未知';
  return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB';
}

function pad2(n) { return String(n).padStart(2, '0'); }
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 桌面目录：优先用户目录下的 Desktop，其次 OneDrive\\Desktop（中英文都试）。 */
function desktopDir() {
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Desktop'),
    path.join(home, 'OneDrive', 'Desktop'),
    path.join(home, '桌面'),
    path.join(home, 'OneDrive', '桌面')
  ];
  for (const dir of candidates) {
    try { if (fs.statSync(dir).isDirectory()) return dir; } catch {}
  }
  return path.join(home, 'Desktop');
}

/** 只允许一个纯文件名：不能带目录分隔符、不能 ..、不能是绝对路径。 */
function safeFileName(raw, fallback) {
  const name = String(raw == null ? '' : raw).trim();
  if (!name) return fallback;
  if (name === '.' || name === '..') return fallback;
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) return fallback;
  if (name.length > 60) return fallback;
  return name.endsWith('.txt') ? name : name + '.txt';
}

function collectStatus() {
  const cpus = os.cpus() || [];
  const total = os.totalmem();
  const free = os.freemem();
  const load = os.loadavg();
  const uptimeH = (os.uptime() / 3600).toFixed(1);
  const lines = [];
  lines.push('时间：' + stamp());
  lines.push('系统：' + os.platform() + ' ' + os.arch() + '，内核 ' + os.release());
  lines.push('开机：' + uptimeH + ' 小时');
  lines.push('CPU：' + (cpus[0]?.model ?? '未知').trim() + ' × ' + cpus.length + '，负载 ' + load.map((n) => n.toFixed(2)).join(' / '));
  lines.push('内存：已用 ' + gb(total - free) + ' / ' + gb(total) + '（' + Math.round(((total - free) / total) * 100) + '%）');
  try {
    const st = fs.statfsSync(desktopDir());
    const diskTotal = st.blocks * st.bsize;
    const diskFree = st.bavail * st.bsize;
    lines.push('桌面所在磁盘：可用 ' + gb(diskFree) + ' / ' + gb(diskTotal));
  } catch {
    lines.push('桌面所在磁盘：读取不到（系统不支持）');
  }
  const mem = process.memoryUsage();
  lines.push('桥接进程：pid ' + process.pid + '，常驻 ' + gb(mem.rss) + '，已运行 ' + (process.uptime() / 3600).toFixed(1) + ' 小时');
  lines.push('node：' + process.version);
  const text = lines.join('\n');
  return text.length > MAX_STATUS_CHARS ? text.slice(0, MAX_STATUS_CHARS) : text;
}

export function createPlugin(ctx) {
  const conf = () => (ctx.config && typeof ctx.config === 'object' ? ctx.config : {});
  const enabled = () => conf().enabled !== false;

  function appendNote(rawText) {
    const c = conf();
    const text = String(rawText == null ? '' : rawText).replace(/\r\n?/g, '\n').trim();
    if (!text) return { ok: false, error: '要写的话不能为空' };
    const max = Math.max(20, Math.min(2000, Number(c.maxNoteChars) || 500));
    if (text.length > max) return { ok: false, error: `一次最多写 ${max} 字，这次太长了` };
    const file = path.join(desktopDir(), safeFileName(c.noteFileName, '小鲸鱼想说的话.txt'));
    const body = (c.timestampNote === false ? '' : '[' + stamp() + '] ') + text + '\n';
    try {
      fs.appendFileSync(file, body, 'utf8');
      ctx.log('已往桌面便签追加一句：' + file);
      // 只回文件名，不回完整路径：路径属于本机敏感信息，模型拿到后容易顺手念进聊天。
      return { ok: true, fileName: path.basename(file), appended: body.trim() };
    } catch (error) {
      return { ok: false, error: '写不进去：' + (error?.message ?? error) };
    }
  }

  ctx.registerTool('user_checking', {
    description: '自查与桌面便签（机主已授权，不用再讨许可）。action=status 读本机运行状态（只读：负载/内存/磁盘/进程），action=note 往桌面那个指定的 txt 追加一句话（只追加，不覆盖不删）。config 里 enabled=false 时整个工具不可用。',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'note'], description: 'status=看本机状态；note=写桌面便签' },
        text: { type: 'string', description: 'action=note 时要写的话（一次一句，短一点）' }
      },
      required: ['action']
    },
    handler: (input) => {
      if (!enabled()) return { ok: false, error: 'user-checking 已在控制台关闭' };
      const action = String(input?.action || '').trim();
      if (action === 'status') {
        return { ok: true, action: 'status', status: collectStatus() };
      }
      if (action === 'note') {
        const out = appendNote(input?.text);
        return { ok: out.ok, action: 'note', ...out };
      }
      return { ok: false, error: 'action 只能是 status 或 note' };
    }
  });

  return {
    hooks: {
      beforePrompt() {
        if (!enabled()) return '';
        const c = conf();
        const name = safeFileName(c.noteFileName, '小鲸鱼想说的话.txt');
        return '【自查与桌面便签】机主开了 user_checking 这个工具，不用每次讨授权就能用：\n'
          + '- 想知道机器/桥接状态好不好（卡不卡、内存紧不紧、跑了多久），直接调用 user_checking(action="status")，它只读指标，不扫进程、不看文件、不碰网络。\n'
          + '- 有想对哥哥说、又不适合当场刷屏的话，可以 user_checking(action="note", text="…") 追加到桌面的「' + name + '」里，只追加一行，不覆盖、不删除。\n'
          + '- 边界：不能改任何文件、不能读别人文件、不能把便签内容或本机路径发到群里；别把机器指标一股脑念出来，挑一两个真的有关的说。';
      }
    }
  };
}
