// Keep Unicode scalar values intact at prompt chunk and truncation boundaries.
export function repairPromptUnicode(value) {
  return String(value ?? '').replace(/([\uD800-\uDBFF])\n\n([\uDC00-\uDFFF])/g, '$1$2').toWellFormed();
}
export function slicePromptUnicode(value, limit) {
  const text = repairPromptUnicode(value);
  let end = Math.min(text.length, Math.max(0, limit));
  if (end < text.length && end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return text.slice(0, end);
}
export function splitPromptUnicode(value, chunkSize = 1200, totalLimit = 8000) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 2) throw new RangeError('chunkSize must be at least 2');
  const text = slicePromptUnicode(String(value || '').trim(), totalLimit), chunks = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    chunks.push(text.slice(start, end)); start = end;
  }
  return chunks;
}
