const APP_URL = 'https://portal.example.invalid/gsapp/sys/xsbgglappustc/*default/index.do#/xsbgxk';
const isReportData = r => r.url().includes('/wxbgbgdz.do') && !r.request().postData()?.includes('*searchMeta=1');

export async function openReportTableDOM(browser, query) {
  const page = await browser.newPage();
  try {
    const ready = page.waitForResponse(isReportData, { timeout: 20000 });
    ready.catch(() => {});
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
    const initial = await ready;
    if (initial.status() !== 200) throw new Error('学术报告页面查询失败：HTTP ' + initial.status());
    await page.waitForFunction(() => typeof window.jQuery?.fn?.emapdatatable === 'function' &&
      window.jQuery('#wxbg-index-table').length > 0, { timeout: 10000 });
    const loaded = page.waitForResponse(isReportData, { timeout: 20000 });
    loaded.catch(() => {});
    await page.evaluate(params => {
      window.jQuery('#wxbg-index-table').emapdatatable('reload', {
        ...params, querySetting: JSON.stringify(params.querySetting || [])
      });
    }, query);
    const response = await loaded;
    if (response.status() !== 200) throw new Error('学术报告筛选失败：HTTP ' + response.status());
    const payload = await response.json();
    const rows = payload?.datas?.wxbgbgdz?.rows;
    if (!Array.isArray(rows)) throw new Error('学术报告页面未返回有效列表');
    await page.waitForFunction(({ count, first }) => {
      const rows = window.jQuery('#wxbg-index-table').jqxDataTable('getRows');
      return rows.length === count && (!count || rows[0].BGBM === first);
    }, { timeout: 10000 }, { count: rows.length, first: rows[0]?.BGBM });
    const domRows = await page.evaluate(() => window.jQuery('#wxbg-index-table').jqxDataTable('getRows'));
    return { page, rows: domRows };
  } catch (error) {
    if (/\/cas\/login|id\.ustc\.edu\.cn\/cas\//i.test(page.url())) error.error_type = 'auth';
    await page.close().catch(() => {});
    throw error;
  }
}

export async function selectReportDOM(page, bgbm) {
  const pending = page.waitForResponse(r => r.url().includes('/selectBg.do') &&
    (r.request().postData() || '').includes(bgbm), { timeout: 15000 });
  pending.catch(() => {});
  const clicked = await page.evaluate(id => {
    const button = [...document.querySelectorAll('#selectBg[data-bgbm]')].find(node => node.dataset.bgbm === id);
    if (!button) return false;
    button.click();
    return true;
  }, String(bgbm));
  if (!clicked) return { ok: false, error: '页面上没有对应课程的选课按钮' };
  const response = await pending;
  if (response.status() !== 200) return { ok: false, error: 'HTTP ' + response.status() };
  const result = await response.json();
  return { ok: String(result?.code) === '0', error: result?.msg || '服务器未确认选课成功' };
}
