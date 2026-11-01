#!/usr/bin/env node
// 从 campus-watch 的浏览器（9222）导出 yjs1.ustc.edu.cn 的 cookie 到 campus-cookies.json。
// 用途：Python 抢课脚本用 requests 直连 yjs1，需要浏览器里实时刷新的 GS_SESSIONID/_WEU。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COOKIES_FILE = path.join(ROOT, 'state', 'campus-cookies.json');
const PORT = 9222;

async function main() {
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
  } catch (e) {
    console.error('无法连接 9222 浏览器：' + (e?.message ?? e));
    process.exit(1);
  }
  try {
    const page = (await browser.pages())[0] || await browser.newPage();
    const cdp = await page.createCDPSession();
    const { cookies } = await cdp.send('Network.getAllCookies');
    await cdp.detach();
    const yjs = cookies.filter((c) => c.domain === 'yjs1.ustc.edu.cn');
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2), 'utf8');
    console.log('导出完成：共 ' + cookies.length + ' 条 cookie，yjs1 域 ' + yjs.length + ' 条');
    for (const c of yjs) console.log('  ' + c.name + ' = ' + String(c.value).slice(0, 24) + '...');
  } catch (e) {
    console.error('导出失败：' + (e?.message ?? e));
    process.exit(1);
  } finally {
    try { await browser.disconnect(); } catch {}
  }
}

main();
