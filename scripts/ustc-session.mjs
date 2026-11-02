import {assertReportAuthenticated,assertReportResponse} from './ustc-report-auth.mjs';

export async function prepareReportSession(browser) {
  const page = await browser.newPage();
  try {
    // Portal authentication alone is insufficient: initialize the report application session.
    const ready = page.waitForResponse(response =>
      response.url().includes('/wxbgbgdz.do') &&
      !response.request().postData()?.includes('*searchMeta=1'), { timeout: 20000 });
    ready.catch(() => {});
    await page.goto('https://example.invalid/gsapp/sys/xsbgglappustc/*default/index.do#/xsbgxk',
      { waitUntil: 'domcontentloaded', timeout: 25000 });
    await assertReportAuthenticated(page);
    const response=await ready;
    assertReportResponse(response);
    const data = await response.json();
    if (!Array.isArray(data?.datas?.wxbgbgdz?.rows)) throw new Error('学术报告查询返回无效数据，未导出会话');
    return await page.browserContext().cookies();
  } catch(error) {
    await assertReportAuthenticated(page);
    throw error;
  } finally {
    await page.close().catch(() => {});
  }
}
