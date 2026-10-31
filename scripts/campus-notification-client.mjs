import crypto from 'node:crypto';

// The monitor has one management delivery contract. Never fall back to an
// agent conversation endpoint or maintain a second set of delivery receipts.
export async function sendCampusNotification({ endpoint, consoleToken, key, text, items, log = () => {}, fetchImpl = fetch, now = Date.now() }) {
  const batch = items || [{ id: 'campus:' + crypto.createHash('sha256').update(String(text)).digest('hex'), text, sourceAt: now, expiresAt: now + 30 * 60000 }];
  const response = await fetchImpl(endpoint + '/api/notifications/send', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-console-token': consoleToken },
    body: JSON.stringify({ key, items: batch }), signal: AbortSignal.timeout(30000)
  });
  if (response.status === 404) throw new Error('管理端缺少统一通知接口，请完成桥接更新；监控结果保留待发送。');
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('通知未受理：' + (result.reason || response.status));
  log('通知处理：' + (result.sent ? '已发' : result.uncertain ? '结果待核实，禁止自动重发' : '重复或过期，跳过'));
  return true;
}
