// Persistent document owns facts, today's provisional portrait and display diary only.
export function parseMemoryDocument(text) {
  const out = { facts: [], portrait: [], unfinished: [], diary: [] };
  const names = { 重要事实: 'facts', 客观陈述: 'facts', 重要信息: 'facts', 用户画像: 'portrait', 未完成事项: 'unfinished', 日记: 'diary' };
  let current = 'facts';
  for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const title = /^(?:#{1,3}\s*)?【([^】]+)】\s*$/.exec(line.trim()) || /^#{1,3}\s+(.+?)\s*$/.exec(line.trim());
    if (title && names[title[1]]) { current = names[title[1]]; continue; }
    if (line.trim()) out[current].push(line);
  }
  return out;
}
const unique = lines => [...new Map(lines.map(line => [line.trim().replace(/^[-*]\s*/, ''), line.trim()])).values()];
export function renderPersistentDocument(parts) {
  return [['重要事实', parts.facts], ['用户画像', parts.portrait], ['日记', parts.diary]]
    .map(([name, lines]) => `【${name}】\n${(lines || []).join('\n')}`).join('\n\n');
}
export function mergePersistentDocument(previous, incoming) {
  const old = parseMemoryDocument(previous), next = parseMemoryDocument(incoming);
  return renderPersistentDocument({ ...next, facts: unique([...old.facts, ...next.facts]) });
}
export function selectPersistentContext(text, maxChars, { includeDiary = false, includePortrait = true } = {}) {
  const parts = parseMemoryDocument(text), limit = Math.max(0, Number(maxChars) || 0);
  let result = '';
  // Reserve a share for today's portrait rather than letting the first section swallow it.
  const groups = [['用户画像｜临时观察，不能覆盖QQ人物档案', includePortrait ? parts.portrait : [], Math.floor(limit * .3)],
    ['重要事实｜本会话逐条记录，最近记录优先', [...parts.facts].reverse(), limit]];
  if (includeDiary) groups.push(['日记｜仅供本次整理参考', parts.diary, limit]);
  for (const [name, lines, share] of groups) {
    let section = '';
    for (const line of lines) {
      const candidate = (section ? section + '\n' : `【${name}】\n`) + line;
      if (candidate.length <= share && result.length + candidate.length + (result ? 1 : 0) <= limit) section = candidate;
    }
    if (section) result += (result ? '\n' : '') + section;
  }
  return result;
}
