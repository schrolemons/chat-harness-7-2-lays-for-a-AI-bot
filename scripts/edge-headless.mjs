import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 9222;
const PROFILE = path.join(ROOT, "state", "campus-profile");
const COOKIE_JAR = path.join(ROOT, "state", "campus-cookies.json");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  try { return await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null }); } catch { return null; }
}
async function inject(browser) {
  if (!fs.existsSync(COOKIE_JAR)) return 0;
  let cookies = [];
  try { cookies = JSON.parse(fs.readFileSync(COOKIE_JAR, "utf8")); } catch { return 0; }
  const page = (await browser.pages())[0] || await browser.newPage();
  const cdp = await page.createCDPSession();
  let n = 0;
  for (const c of cookies) {
    try {
      await cdp.send("Network.setCookie", {
        name: c.name, value: c.value, domain: c.domain, path: c.path || "/",
        secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: c.sameSite,
        ...(c.expires > 0 ? { expires: c.expires } : {})
      });
      n++;
    } catch {}
  }
  await cdp.detach();
  return n;
}

let browser = await connect();
if (!browser) {
  fs.mkdirSync(PROFILE, { recursive: true });
  const child = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--profile-directory=Default", "--no-first-run", "--no-default-browser-check", "about:blank"], { detached: true, stdio: "ignore" });
  child.unref();
  for (let i = 0; i < 40; i++) { await sleep(600); browser = await connect(); if (browser) break; }
}
if (!browser) { console.error("headless Edge 启动失败"); process.exit(1); }
const n = await inject(browser);
const pages = await browser.pages();
const page = pages[0] || await browser.newPage();
const state = await page.evaluate(async () => {
  const out = {};
  try { const r = await fetch("https://example.invalid/gsapp/sys/yjsemaphome/portal/index.do", { credentials: "include" }); const t = await r.text(); out.yjs = /黄茁恒|研究生综合服务平台/.test(t); } catch (e) { out.yjsError = String(e); }
  try { const r = await fetch("https://example.invalid/", { credentials: "include" }); const t = await r.text(); out.bb = /黄茁恒|我的课程/.test(t); } catch (e) { out.bbError = String(e); }
  return out;
});
console.log(JSON.stringify({ cookieInjected: n, ...state }));
await browser.disconnect();
