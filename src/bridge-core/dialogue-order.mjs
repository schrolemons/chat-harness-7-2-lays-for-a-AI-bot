// Sort real recorded identities only; do not invent sequence numbers for legacy rows.
export function orderDialogueRows(rows, sequence = row => row?.dialogueSeq) {
  const valid = row => Number.isSafeInteger(sequence(row)) && sequence(row) > 0;
  const ordered = rows.filter(valid).sort((a,b) => sequence(a)-sequence(b));
  let index = 0;
  return rows.map(row => valid(row) ? ordered[index++] : row);
}
