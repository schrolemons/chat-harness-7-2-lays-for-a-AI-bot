import fs from "node:fs";
import puppeteer from "puppeteer-core";
const PORT = 9227;
const out = { startedAt: new Date().toISOString(), steps: [] };
const log = (m) => { console.log(m); out.steps.push(m); };
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:" + PORT, defaultViewport: null });
let pages = [];
const deadline = Date.now() + 15 * 60 * 1000;
let logged = false;
while (Date.now() < deadline) {
  try {
    pages = await b.pages();
  } catch { break; }
  const bbPage = pages.find(p => p.url().includes("bb.ustc.edu.cn"));
  if (!bbPage) { await new Promise(r=>setTimeout(r,3000)); continue; }
  try {
    const text = await bbPage.evaluate(() => document.body ? document.body.innerText.slice(0, 4000) : "");
    logged = /我的课程|我的机构|退出登录|注销|个人主页/.test(text) || (!/需要先验证身份|统一身份认证登录|请输入用户名|账号登录/.test(text) && /课程/.test(text) && text.length > 600);
    if (logged) { log("LOGIN_OK " + bbPage.url().slice(0, 100)); break; }
    log("waiting-login");
  } catch { log("waiting-error"); }
  await new Promise(r=>setTimeout(r,4000));
}
if (!logged) { log("TIMEOUT_OR_CLOSED"); fs.writeFileSync("state/browser-fetch-login.json", JSON.stringify(out, null, 2), "utf8"); await b.disconnect().catch(()=>{}); process.exit(0); }
async function grab(url, waitMs = 4000) {
  const p = await b.newPage();
  try {
    await p.goto(url, { waitUntil: "networkidle2", timeout: 60000 }).catch(()=>{});
    await new Promise(r=>setTimeout(r,waitMs));
    const title = await p.title().catch(()=>"");
    const text = await p.evaluate(() => document.body ? document.body.innerText : "").catch(()=>"");
    log("GRAB " + url.slice(0,80) + " | " + title + " | " + text.length + "字");
    return { url: p.url(), title, text: text.replace(/\r/g,"").replace(/\n{3,}/g,"\n\n").trim().slice(0, 20000) };
  } finally { try { await p.close(); } catch {} }
}
const sites = JSON.parse(fs.readFileSync("browser-sites.json","utf8")).sites;
out.results = {};
for (const name of ["学习平台", "研究生培养"]) {
  if (!sites[name]) continue;
  try { out.results[name] = await grab(sites[name].url, sites[name].waitMs || 4000); }
  catch (e) { out.results[name] = { error: String(e.message||e) }; log("FAIL " + name + ": " + e.message); }
}
fs.writeFileSync("state/browser-fetch-login.json", JSON.stringify(out, null, 2), "utf8");
log("DONE saved state/browser-fetch-login.json");
await b.disconnect().catch(()=>{});
