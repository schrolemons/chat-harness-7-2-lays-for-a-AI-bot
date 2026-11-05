import { createHash } from 'node:crypto';

export const LEGACY_SNOW_QUOTE_PATCH_INPUT = 'e23ed3d4aa7e01e7f45400a7ffe6b0c4b67bb6d011f776f2fd04b959510435e6';
export const SNOW_QUOTE_PATCH_INPUT = '2af79d5759b65a15a97a1f6d600b4ce895b54d2b2fc475b8aa566f57035c2e93';
export const SNOW_QUOTE_PATCH_ID = 'reply-clientseq-time-window-v1';
// The existing reviewed 2.1.1 patch, restricted to its exact original input.
export function patchSnowQuote(input) {
  const digest = createHash('sha256').update(input).digest('hex');
  if (digest !== SNOW_QUOTE_PATCH_INPUT && digest !== LEGACY_SNOW_QUOTE_PATCH_INPUT) throw Error('PATCH_INPUT_MISMATCH');
  if (digest === SNOW_QUOTE_PATCH_INPUT) return patchGroupQuote(input.toString('utf8'));
  const source = input.toString('utf8');
  const find = '\tif (await ref.messageStore.findEvent(targetId)) return;\n';
  if (source.split(find).length !== 2) throw Error('PATCH_ANCHOR_MISMATCH');
  return Buffer.from(source.replace(find,
    '\tconst _prevStored = await ref.messageStore.findEvent(targetId);\n' +
    '\tif (_prevStored) {\n' +
    '\t\tconst _qt = reply?.replyTime && reply.replyTime > 0 ? reply.replyTime : event.time;\n' +
    '\t\tif (typeof _prevStored.time === "number" && Math.abs(_prevStored.time - _qt) < 21600) return;\n' +
    '\t}\n'));
}

function patchGroupQuote(source) {
  const anchor = '\tif (await ref.messageStore.findEvent(targetId)) return targetId;\n';
  if (source.split(anchor).length !== 2) throw Error('PATCH_ANCHOR_MISMATCH');
  return Buffer.from(source.replace(anchor,
    '\tconst _prevStored = await ref.messageStore.findEvent(targetId);\n' +
    '\tconst _qt = reply.replyTime;\n' +
    '\tif (_prevStored && (!(_qt > 0) || (typeof _prevStored.time === "number" && Math.abs(_prevStored.time - _qt) < 21600))) return targetId;\n'));
}
