// In-memory persistence for the Calls page "current customer" selection.
//
// Each route is a mounted element, so navigating away from /calls UNMOUNTS
// CallsPage and destroys its local state — on return the page re-derives the
// customer from the queue and can land on a different one (e.g. the prior
// customer was parked by a no-answer and filtered out). That looked like the
// customer being auto-skipped.
//
// This module-scoped snapshot lets CallsPage restore the exact customer it was
// on. It is intentionally in-memory (not sessionStorage): it survives in-app
// navigation but resets on a full page reload — matching the live VOIP call,
// which is also in-memory and dies on reload. Per-tab, so no cross-tab issues.
export interface CallSessionSnapshot {
  selectedPhone: string;
  currentSource: 'pending' | 'prediction' | 'manual' | null;
  currentPendingOrderId: string | null;
  queueCurrentPhone: string | null;
  activeListId: string | null;
  manualPick: boolean;
  pendingAdvance: { phone: string; outcome: string } | null;
}

let snapshot: CallSessionSnapshot | null = null;

export const getCallSession = (): CallSessionSnapshot | null => snapshot;
export const setCallSession = (s: CallSessionSnapshot | null): void => { snapshot = s; };
