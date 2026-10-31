import crypto from 'node:crypto';
import { pendingEnrollments, acknowledgeEnrollments } from './ustc-course-policy.mjs';

export function enrollmentChange(item) {
  return { kind: 'enrolled', notificationKey: item.bgbm,
    msg: '✅ 已抢到报告：' + (item.time ? item.time + ' ' : '') + (item.title || '') +
      (item.dept ? '\n组织：' + item.dept : '') + (item.place ? '\n地点：' + item.place : '') +
      '\n课程号：' + item.bgbm };
}

export async function dispatchOwnerChanges({ dir, state, changes, send }) {
  const now=Date.now();
  const allPending=pendingEnrollments(dir);
  const stale=allPending.filter(x=>now-Number(x.at||0)>24*3600000);
  acknowledgeEnrollments(dir,stale.map(x=>x.bgbm));
  const pending = allPending.filter(x=>!stale.includes(x));
  const loginRecent = Date.now() - (Number(state.lastLoginNoticeAt) || 0) < 6 * 3600000;
  const outbound = changes.filter(item => !(item.kind === 'login' && loginRecent) && (!item.sourceAt || now-item.sourceAt<24*3600000));
  for (const item of pending) {
    if (!outbound.some(change => change.notificationKey === item.bgbm)) outbound.push(enrollmentChange(item));
  }
  if (!outbound.length) return { sent: false, count: 0 };
  const text = '📚 校园检查\n' + [...new Set(outbound.map(change => change.msg))].join('\n');
  let delivered;
  try { delivered = await send(text,{items:outbound.map(item=>({id:item.deliveryId||(item.notificationKey?'campus-enrolled:'+item.notificationKey:'campus:'+crypto.createHash('sha256').update(item.kind+':'+item.msg).digest('hex')),text:item.msg,sourceAt:item.sourceAt||now,expiresAt:(item.sourceAt||now)+24*3600000}))}); } catch (error) { return { sent: false, count: outbound.length, error: error.message }; }
  if (delivered !== true) return { sent: false, count: outbound.length };
  const ids = outbound.filter(change => change.notificationKey).map(change => change.notificationKey);
  acknowledgeEnrollments(dir, ids);
  state.notifiedGrab ||= {};
  for (const id of ids) state.notifiedGrab[id] = Date.now();
  if (outbound.some(change => change.kind === 'login')) state.lastLoginNoticeAt = Date.now();
  return { sent: true, count: outbound.length };
}
