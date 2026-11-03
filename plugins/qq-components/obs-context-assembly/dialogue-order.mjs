import { orderDialogueRows } from '../../../src/bridge-core/dialogue-order.mjs';
import { qqDialogueBlocks } from '../../../console/layers/O/context-qq-blocks.js';

// Reorder only bridge-owned QQ data in the rendered surface. Raw log events,
// system rules, task slots and native tool-call/result pairs are never moved.
export function orderProjectedDialogue({ session, messages, position, replace }) {
  const containers = [];
  const own = message => message?.source?.kind === 'qq-context-dialogue'
    || message?.source?.kind === 'qq-context-stable' && message.source.baseSource?.kind === 'qq-context-dialogue';
  for (const seq of [...session.surface.nodes]) {
    const event = session.eventAt(seq);
    if (event?.type === 'user/message' && own(event.data)) containers.push({ seq, message: event.data });
  }
  for (let index = 0; index < messages.length; index++) if (own(messages[index])) containers.push({ index, message: messages[index] });
  const slots = containers.flatMap(container => (container.message.content || []).flatMap((block,index) => block.type === 'text'
    ? qqDialogueBlocks(block.text).map(part => ({ ...part, container, blockIndex: index })) : []));
  const ordered = orderDialogueRows(slots.flatMap(slot => slot.rows));
  let offset = 0;
  for (const slot of slots) { slot.sorted = ordered.slice(offset, offset + slot.rows.length); offset += slot.rows.length; }
  for (const container of containers) {
    let changed = false;
    const content = container.message.content.map((block,index) => {
      let text = block.text;
      for (const slot of slots.filter(slot => slot.container === container && slot.blockIndex === index).reverse()) {
        if (JSON.stringify(slot.rows) === JSON.stringify(slot.sorted)) continue;
        text = text.slice(0,slot.start) + slot.heading + '\n' + JSON.stringify(slot.sorted) + text.slice(slot.end); changed = true;
      }
      return text === block.text ? block : { ...block, text };
    });
    if (!changed) continue;
    const rows = slots.filter(slot => slot.container === container).flatMap(slot => slot.sorted);
    const update = source => ({ ...source, seqs: rows.map(row => row.seq).filter(Number.isSafeInteger), dialogueSeqs: rows.map(row => row.dialogueSeq).filter(Number.isSafeInteger), dialogueOrder: 'ascending-v1' });
    const source = container.message.source.kind === 'qq-context-stable'
      ? { ...container.message.source, baseSource: update(container.message.source.baseSource) } : update(container.message.source);
    const message = { ...container.message, content, source };
    if (container.seq !== undefined) replace(session,container.seq,message,position);
    else messages[container.index] = message;
  }
  return messages;
}
