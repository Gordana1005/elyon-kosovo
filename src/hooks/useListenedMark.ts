import { useCallback, useRef } from 'react';
import type { SyntheticEvent } from 'react';
import { apiMarkCallListened } from '@/lib/api';

// A recording counts as "listened" only after this much REAL playback.
const LISTEN_THRESHOLD_SECONDS = 10;

// Team-wide "reviewed" mark for call recordings. Attach the returned handler to
// an <audio>'s onTimeUpdate: it accumulates actual played time (per-tick deltas
// capped at 1.5s, so seeking/skipping doesn't count) and fires
// apiMarkCallListened exactly once when the threshold is reached.
// `enabled` should be true only for hear-all reviewer roles — the mark means
// "a reviewer checked this call", so own-scoped agents never set it.
export function useListenedMark(enabled: boolean, onMarked?: (callId: string) => void) {
  const progress = useRef<Record<string, { total: number; last: number | null }>>({});
  const marked = useRef<Set<string>>(new Set());

  return useCallback(
    (callId: string, alreadyListened: boolean) => (e: SyntheticEvent<HTMLAudioElement>) => {
      if (!enabled || alreadyListened || marked.current.has(callId)) return;
      const now = e.currentTarget.currentTime;
      const p = progress.current[callId] || (progress.current[callId] = { total: 0, last: null });
      if (p.last !== null) {
        const delta = now - p.last;
        if (delta > 0 && delta <= 1.5) p.total += delta;
      }
      p.last = now;
      if (p.total >= LISTEN_THRESHOLD_SECONDS) {
        marked.current.add(callId);
        apiMarkCallListened(callId)
          .then(() => onMarked?.(callId))
          .catch(() => { marked.current.delete(callId); }); // retry on further playback
      }
    },
    [enabled, onMarked],
  );
}
