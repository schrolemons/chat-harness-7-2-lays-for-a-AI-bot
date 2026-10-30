// Truncate text before serialization, keeping user-perceived characters intact.
// A grapheme includes joined emoji, skin-tone modifiers, flags and accents.
const graphemes = new Intl.Segmenter('und', {granularity:'grapheme'});
export function repairPromptUnicode(value) {
  return String(value ?? '').replace(/([\uD800-\uDBFF])\n\n([\uDC00-\uDFFF])/g, '$1$2').toWellFormed();
}
export function slicePromptUnicode(value, limit) {
  const text = repairPromptUnicode(value);
  const cap = Math.max(0, Math.floor(Number(limit)) || 0);
  if (text.length <= cap) return text;
  let end = 0;
  for (const {index,segment} of graphemes.segment(text)) {
    const next = index + segment.length;
    if (next > cap) break;
    end = next;
  }
  return text.slice(0, end);
}
export function splitPromptUnicode(value, chunkSize = 1200, totalLimit = 8000) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 2) throw new RangeError('chunkSize must be at least 2');
  const text = slicePromptUnicode(String(value || '').trim(), totalLimit), chunks = [];
  let chunk = '';
  for (const {segment} of graphemes.segment(text)) {
    if (chunk && chunk.length + segment.length > chunkSize) {
      chunks.push(chunk); chunk = '';
    }
    chunk += segment;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
