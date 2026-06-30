// Display-side cleanup for the order/call notes the import scripts wrote.
//
// The CPA + OUTBOUND imports tagged each note with provenance so we'd know
// where it came from while debugging — e.g.
//
//   "Status note: платено | Operator: Гергана | Extra: ИСКА ФАКТУРА |
//    Imported from \"IN,CPA and OUT.xlsx\" (OUTBOUND sheet, original 199.40 LEV)"
//
// Agents on the Calls page only care about the agent-visible parts (status,
// operator, extras). This helper strips the technical trail without touching
// the underlying data.

const HIDDEN_PREFIXES = [
  'Imported from ',
  'Original date ',
];

export function cleanNoteForDisplay(text: string | null | undefined): string {
  if (!text) return '';
  // Drop the technical backup payload the address-restructure script appends
  // ("... __ORIG__{json}" / legacy "Original: city=..."). It's stored only so
  // the backfill can be reverted — it should never reach a human reader.
  const stripped = text
    .replace(/\s*__ORIG__[\s\S]*$/, '')
    .replace(/\s*Original: city=[\s\S]*$/, '')
    .trim();
  return stripped
    .split(' | ')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !HIDDEN_PREFIXES.some(p => s.startsWith(p)))
    .join(' | ');
}
