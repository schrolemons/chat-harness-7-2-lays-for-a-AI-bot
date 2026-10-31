#!/usr/bin/env node
/**
 * browser-fetch.mjs — 本机"真实浏览器"取数工具（管理员开发模式）。
 *
 * 默认复用 **Edge 的登录态**：把 %LOCALAPPDATA%\Microsoft\Edge\User Data\Default
 * 同步到仓库里的 state/edge-profile，再用 Edge 打开这个副本去访问页面。
 * 这样既用上了你 Edge 里已有的登录 cookie，又避开了新版 Chromium
 * 「不给默认配置开远程调试」的限制，也不需要你把账号密码交给任何脚本。
 *
 * 安全说明（不会被 QQ / 学校判定违规）：
 *   · 真实 Edge 内核 + 你本机正常网络 + 真实登录态，不是爬虫指纹；
 *   · 一次只访问一个页面、只读文本/链接，低频、不并发、不批量；
 *   · 不自动输入账号密码，不保存凭据；QQ 只是发指令的通道。
 *
 * 首次使用：
 *   1) 完全退出 Edge（任务栏右键退出，确保任务管理器里没有 msedge.exe）；
 *   2) node scripts/browser-fetch.mjs --sync-edge
 *   3) 之后就可以 node scripts/browser-fetch.mjs --site 学习平台
 *   登录过期时重新执行 1)~2) 同步一次。
 *
 * 站点配置：仓库根目录 browser-sites.json（参考 browser-sites.example.json）
 *   { "sites": { "学习平台": { "url": "https://...", "waitMs": 3000 } } }
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALAPPDATA = process.env.LOCALAPPDATA || '';
const EDGE_USER_DATA = path.join(LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data');
const PROFILE_COPY = path.join(ROOT, 'state', 'edge-profile');
const DEBUG_PORT = 9227;
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const SKIP_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'ShaderCache', 'GrShaderCache', 'DawnGraphiteCache',
  'DawnWebGPUCache', 'Service Worker', 'Crashpad', 'BrowserMetrics', 'Optimization Hints'];

function parseArgs(argv) {
  const out = { max: 20000, wait: 0, links: false, plain: false, headed: false, login: false, loginEdge: false, closeEdge: false, syncEdge: false, keepOpen: false, stop: false, startEdge: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--url') out.url = next();
    else if (a === '--site') out.site = next();
    else if (a === '--login') out.login = true;
    else if (a === '--login-edge') out.loginEdge = true;
    else if (a === '--headed') out.headed = true;
    else if (a === '--plain') out.plain = true;
    else if (a === '--links') out.links = true;
    else if (a === '--wait') out.wait = Number(next()) || 0;
    else if (a === '--max') out.max = Number(next()) || 20000;
    else if (a === '--profile') out.profile = next();
    else if (a === '--close-edge') out.closeEdge = true;
    else if (a === '--sync-edge') out.syncEdge = true;
    else if (a === '--keep-open') out.keepOpen = true;
    else if (a === '--stop') out.stop = true;
    else if (a === '--start-edge') out.startEdge = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function readRootConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch { return {}; }
}
function readSites() {
  for (const f of ['browser-sites.json', 'config.json']) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
      const sites = f === 'config.json' ? j?.browser?.sites : j?.sites;
      if (sites && typeof sites === 'object') return sites;
    } catch {}
  }
  return {};
}
function findEdge(cfg) {
  if (cfg.edgePath && fs.existsSync(cfg.edgePath)) return cfg.edgePath;
  for (const c of EDGE_CANDIDATES) if (fs.existsSync(c)) return c;
  return null;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function edgeRunning() {
  try { return /msedge\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq msedge.exe" /NH', { encoding: 'utf8', timeout: 8000 })); }
  catch { return false; }
}
function killEdge() {
  try { execSync('taskkill /IM msedge.exe /F', { encoding: 'utf8', timeout: 15000, stdio: 'ignore' }); } catch {}
}

function syncEdgeProfile({ closeEdge }) {
  if (edgeRunning()) {
    if (!closeEdge) throw new Error('Edge 正在运行，无法同步登录态。请先完全退出 Edge；或加 --close-edge 自动关闭（重启 Edge 后可恢复标签）。');
    killEdge();
    // 等进程真正退出
    for (let i = 0; i < 20; i += 1) { if (!edgeRunning()) break; execSync('timeout /t 1 >nul', { shell: 'cmd.exe' }); }
  }
  const srcDefault = path.join(EDGE_USER_DATA, 'Default');
  if (!fs.existsSync(srcDefault)) throw new Error('找不到 Edge 默认配置：' + srcDefault);
  fs.mkdirSync(path.join(PROFILE_COPY, 'Default'), { recursive: true });
  const xd = SKIP_DIRS.map((d) => path.join(srcDefault, d)).join(' ');
  const robocopy = `robocopy "${srcDefault}" "${path.join(PROFILE_COPY, 'Default')}" /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 /XD ${SKIP_DIRS.map((d) => `"${d}"`).join(' ')}`;
  console.log('同步 Edge 配置（可能需要几十秒）…');
  try { execSync(robocopy, { shell: 'cmd.exe', stdio: 'ignore', timeout: 300000 }); } catch {}
  // Local State 里有 cookie 加密密钥，必须一起复制
  for (const f of ['Local State', 'First Run']) {
    try { fs.copyFileSync(path.join(EDGE_USER_DATA, f), path.join(PROFILE_COPY, f)); } catch {}
  }
  console.log('已同步登录态到 ' + PROFILE_COPY);
}

async function waitForCdp(port, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {}
    await sleep(700);
  }
  return false;
}

function usage() {
  console.log(`用法：
  node scripts/browser-fetch.mjs --sync-edge [--close-edge]        # 同步 Edge 登录态（需 Edge 已退出）
  node scripts/browser-fetch.mjs --site <名称> [--headed] [--links] [--plain] [--wait 毫秒] [--max 字数]
  node scripts/browser-fetch.mjs --url <url> [同上]
  node scripts/browser-fetch.mjs --login --url <url> --profile state/browser-profile   # 独立配置首次登录（不碰 Edge）
站点配置：browser-sites.json 的 { "sites": { "<名称>": { "url": "...", "waitMs": 2500 } } }`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }
  const cfg = readRootConfig().browser ?? {};
  const edgeExe = findEdge(cfg);

  if (args.syncEdge) {
    if (!edgeExe) throw new Error('找不到 msedge.exe');
    syncEdgeProfile({ closeEdge: args.closeEdge });
    return;
  }

  let url = args.url;
  let waitMs = args.wait;
  const sites = readSites();
  if (!url && args.site) {
    const site = sites[args.site];
    if (!site) throw new Error(`未知站点「${args.site}」；请在 browser-sites.json 里配置。已配置：${Object.keys(sites).join('、') || '（无）'}`);
    url = typeof site === 'string' ? site : site.url;
    waitMs = waitMs || Number(site.waitMs) || 0;
  }
  if (!url) { usage(); throw new Error('缺少 --url 或 --site'); }
  if (!/^https?:\/\//i.test(url)) throw new Error('只支持 http(s) URL');

  const { default: puppeteer } = await import('puppeteer-core');

  // --start-edge：用「junction 指向真实 Edge 配置」的方式启动带调试端口的真实 Edge
  if (args.startEdge) {
    const edgeExe = findEdge(cfg);
    if (!edgeExe) throw new Error('找不到 msedge.exe');
    const userDataDir = cfg.edgeDebugUserData || 'C:\\edge-debug-profile';
    const port = Number(cfg.debugPort) || DEBUG_PORT;
    if (!fs.existsSync(userDataDir)) throw new Error('缺少 junction：' + userDataDir + '（可用 cmd /c mklink /J "C:\\edge-debug-profile" "%LOCALAPPDATA%\\Microsoft\\Edge\\User Data" 创建）');
    execSync('start "" "' + edgeExe + '" --remote-debugging-port=' + port + ' --user-data-dir="' + userDataDir + '" --profile-directory=Default --no-first-run --no-default-browser-check about:blank', { shell: 'cmd.exe', stdio: 'ignore' });
    const ok = await waitForCdp(port);
    if (!ok) throw new Error('启动真实 Edge 后调试端口未就绪');
    console.log('已启动真实 Edge（调试端口 ' + port + '），现在可以像平时一样使用它。');
    return;
  }

  // attach：优先连接你正在运行的（带调试端口的）真实 Edge
  let attached = null;
  try {
    attached = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + (Number(cfg.debugPort) || DEBUG_PORT), defaultViewport: null });
  } catch { attached = null; }

  // --stop：关闭常驻浏览器
  if (args.stop) {
    try {
      const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + (Number(cfg.debugPort) || DEBUG_PORT) });
      await b.close();
      console.log('已关闭常驻浏览器');
    } catch { console.log('没有发现常驻浏览器（可能已关闭）'); }
    return;
  }

  // 独立配置首次登录（Chrome/Edge 都行，不碰 Edge 默认配置）
  if (args.login) {
    const exe = findEdge(cfg);
    if (!exe) throw new Error('找不到 Edge 可执行文件');
    const userDataDir = path.resolve(ROOT, args.profile || path.join('state', 'browser-profile'));
    fs.mkdirSync(userDataDir, { recursive: true });
    const browser = await puppeteer.launch({
      executablePath: exe, userDataDir, headless: false, defaultViewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled', '--lang=zh-CN']
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null);
    console.log('已打开浏览器：' + url);
    console.log('请在这个窗口里完成登录，完成后关闭浏览器窗口即可。登录态保存在 ' + userDataDir);
    await new Promise((resolve) => { browser.once('disconnected', resolve); setTimeout(resolve, 10 * 60 * 1000); });
    return;
  }

  if (attached) {
    // 连接的是用户真实 Edge：新开标签抓取，抓完关掉标签，绝不动用户其它标签。
    const page = await attached.newPage();
    try {
      await sleep(500 + Math.floor(Math.random() * 800));
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null);
      if (waitMs > 0) await sleep(waitMs);
      await sleep(500 + Math.floor(Math.random() * 700));
      const title = await page.title().catch(() => '');
      const finalUrl = page.url();
      let text = '';
      if (!args.links) text = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
      const links = args.links ? await page.evaluate(() => {
        const seen = new Set();
        return [...document.querySelectorAll('a[href]')]
          .map((a) => ({ text: (a.innerText || '').trim().slice(0, 120), href: a.href }))
          .filter((l) => l.href && !seen.has(l.href) && seen.add(l.href))
          .slice(0, 300);
      }).catch(() => []) : undefined;
      const result = {
        ok: true,
        engine: 'edge-real',
        url: finalUrl,
        title,
        fetchedAt: new Date().toISOString(),
        ...(text ? { text: String(text).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, args.max) } : {}),
        ...(links ? { links } : {})
      };
      if (args.plain && text) console.log(result.text);
      else console.log(JSON.stringify(result, null, 2));
    } finally {
      try { await page.close(); } catch {}
      try { attached.disconnect(); } catch {}
    }
    return;
  }

  // 使用同步出来的 Edge 配置副本启动（真实 Edge 内核 + 你的登录态）
  if (!edgeExe) throw new Error('找不到 msedge.exe');
  if (!fs.existsSync(path.join(PROFILE_COPY, 'Default'))) {
    throw new Error('还没有同步 Edge 登录态：请先完全退出 Edge，再运行 node scripts/browser-fetch.mjs --sync-edge');
  }
  const port = Number(cfg.debugPort) || DEBUG_PORT;
  const argsArr = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${PROFILE_COPY}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--lang=zh-CN',
    'about:blank'
  ];
  if (!args.headed && !args.loginEdge) argsArr.unshift('--headless=new');
  execSync(`start "" "${edgeExe}" ${argsArr.map((a) => `"${a}"`).join(' ') }`, { shell: 'cmd.exe', stdio: 'ignore' });
  const ok = await waitForCdp(port);
  if (!ok) throw new Error('启动 Edge 后调试端口未就绪；可试 --headed，或检查安全软件是否拦截 --remote-debugging-port');
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null });
  if (args.loginEdge) {
    const pages = await browser.pages();
    const page = pages.find((p) => !p.url().startsWith('devtools://')) || pages[0] || await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => null);
    console.log('已打开浏览器（Edge 登录态副本）：' + url);
    console.log('请在这个窗口里完成统一身份认证登录；脚本会自动检测，检测到成功会提示“登录成功”。');
    const deadline = Date.now() + 12 * 60 * 1000;
    let announced = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      let state = { url: '', text: '' };
      try { state = await page.evaluate(() => ({ url: location.href, text: document.body ? document.body.innerText.slice(0, 3000) : '' })); } catch {}
      const logged = /我的课程|我的机构|退出登录|注销|个人主页/.test(state.text)
        || (/bb\.ustc\.edu\.cn/.test(state.url) && !/需要先验证身份|统一身份认证登录|请输入用户名/.test(state.text) && state.text.length > 800 && /课程|通知/.test(state.text));
      if (logged && !announced) {
        announced = true;
        let cookies = [];
        try { cookies = await page.cookies('https://portal.example.invalid'); } catch {}
        console.log('✅ 登录成功（url=' + state.url.slice(0, 80) + '，cookie=' + cookies.length + ' 个）');
        console.log('现在可以关闭这个浏览器窗口了；关闭后登录态会保存到 state/edge-profile。');
      }
    }
    // 保持浏览器常驻：Blackboard 的会话 cookie 关掉浏览器就丢，所以登录后不要关闭它。
    try { browser.disconnect(); } catch {}
    console.log('浏览器保持运行（登录态在线）。后续抓取会直接复用它；不需要时运行 node scripts/browser-fetch.mjs --stop');
    return;
  }
  try {
    const pages = await browser.pages();
    const page = pages.find((p) => !p.url().startsWith('devtools://')) || pages[0] || await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      try { Object.defineProperty(navigator, 'webdriver', { get: () => false }); } catch {}
    });
    await sleep(1000 + Math.floor(Math.random() * 1500));
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null);
    if (waitMs > 0) await sleep(waitMs);
    await sleep(700 + Math.floor(Math.random() * 1000));

    const title = await page.title().catch(() => '');
    const finalUrl = page.url();
    let text = '';
    if (!args.links) text = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    const links = args.links ? await page.evaluate(() => {
      const seen = new Set();
      return [...document.querySelectorAll('a[href]')]
        .map((a) => ({ text: (a.innerText || '').trim().slice(0, 120), href: a.href }))
        .filter((l) => l.href && !seen.has(l.href) && seen.add(l.href))
        .slice(0, 300);
    }).catch(() => []) : undefined;

    const result = {
      ok: true,
      engine: 'edge',
      url: finalUrl,
      title,
      fetchedAt: new Date().toISOString(),
      ...(text ? { text: String(text).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, args.max) } : {}),
      ...(links ? { links } : {})
    };
    if (args.plain && text) console.log(result.text);
    else console.log(JSON.stringify(result, null, 2));
  } finally {
    // 常驻模式：只关掉本次打开的空白页/抓取页，不关闭浏览器（保留登录会话）。
    try { const pages = await browser.pages(); for (const p of pages) { if (p.url() === 'about:blank' || p.url() === '') await p.close().catch(() => {}); } } catch {}
    try { browser.disconnect(); } catch {}
    if (args.keepOpen === false && process.env.BROWSER_CLOSE_AFTER === '1') { try { await browser.close(); } catch {} }
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  process.exit(1);
});
