#!/usr/bin/env node
/**
 * lecture-enroll.mjs — 在研究生平台「学术报告选课」里按标题选课（高新校区讲座用）。
 *
 * 用法：node scripts/lecture-enroll.mjs --title "网络安全技术、产品及演进趋势"
 *      node scripts/lecture-enroll.mjs --title "..." --dry-run
 *
 * 行为：复用 campus-watch 的报告筛选规则和成功记录，只有服务器明确确认后才返回 ok=true。
 * dry-run 只读页面，不触发选课。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { loadCoursePolicy, eligibleReports, processDOMRows } from './ustc-course-policy.mjs';
import { openReportTableDOM, selectReportDOM } from './ustc-dom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAB_DIR = path.join(ROOT, 'scripts', 'ustc-grab-report-course');
const PORT = 9222;

function arg(name, def = '') {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const TITLE = arg('title', '');
const DRY = process.argv.includes('--dry-run');

async function main() {
  if (!TITLE && !arg('bgbm')) throw new Error('请传入 --title 或 --bgbm');
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
  let page;
  try {
    const policy=loadCoursePolicy(GRAB_DIR,{locationKeyword:'高新'});
    const table=await openReportTableDOM(browser,policy.query);page=table.page;
    const bgbm=arg('bgbm');
    let rows=eligibleReports(table.rows,policy).filter(row=>bgbm?String(row.BGBM)===bgbm:row.BGTMZW===TITLE);
    if(DRY){console.log(JSON.stringify({ok:true,dryRun:true,candidates:rows.map(row=>({bgbm:row.BGBM,title:row.BGTMZW,time:row.BGSJ,place:row.DD}))}));return;}
    const result=await processDOMRows(rows,policy,row=>selectReportDOM(page,row.BGBM));
    console.log(JSON.stringify({ok:result.grabbed.length>0,full:result.full.length>0,grabbed:result.grabbed,failed:result.failed.map(item=>({title:item.course.BGTMZW,error:item.error}))}));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, title: TITLE, error: error?.message ?? String(error) }, null, 2));
    process.exitCode = 1;
  } finally {
    if(page) await page.close().catch(()=>{});
    await browser.disconnect();
  }
}

main();
