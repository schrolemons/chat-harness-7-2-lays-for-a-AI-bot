import {receiptStateV2} from '../../../src/bridge-core/receipt-state.js';
const isPoke = m => m?.kind === 'poke' || !!m?.poke;
const timeOf = m => Number(m?.time) || 0;
export function buildInteractionState(st) {
  if (!st) return '';
  const recent = Array.isArray(st.recentMessages) ? st.recentMessages : [];
  const unread = Array.isArray(st.unread) ? st.unread : [];
  const window = (recent.length ? recent : unread).slice(-16);
  const from = window.length ? Math.min(...window.map(timeOf)) : 0;
  const rows = new Map();
  for (const m of [...window, ...unread.filter(m => timeOf(m) >= from)]) {
    if (!m || m.isSelf || !Number.isSafeInteger(m.seq)) continue;
    const old = rows.get(m.seq);
    if (!old || receiptStateV2(m) === 'complete' || receiptStateV2(old) !== 'complete') rows.set(m.seq,m);
  }
  const messages = [...rows.values()].sort((a,b) => timeOf(a)-timeOf(b) || a.seq-b.seq);
  const latest = messages.at(-1);
  if (!latest) return '';
  const pokes = messages.filter(m => isPoke(m) && m.poke?.targetIsSelf === true);
  const pending = pokes.filter(m => receiptStateV2(m) !== 'complete').map(m => m.seq);
  const completed = pokes.filter(m => receiptStateV2(m) === 'complete').map(m => m.seq);
  const kind = isPoke(latest) ? latest.poke?.targetIsSelf === true ? '拍一拍bot' : '拍一拍（其他或未知目标）' : '消息';
  return `【交互事件事实】最新入站seq=${latest.seq}，类型=${kind}；窗口内未回应拍一拍seq=${JSON.stringify(pending)}；已回应拍一拍seq=${JSON.stringify(completed)}。同一seq只是一件事，已回应的不再当新戳；空@、点名不是新的拍一拍。唤醒原因是本轮起点，重复出现不表示又发生一次；只有新结构化poke事件才可说“又戳”。`;
}
