import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiHeartbeatActiveView, apiReleaseActiveView } from '@/lib/api';

const HEARTBEAT_MS = 30_000; // server expires after 2 min, beat every 30s

/**
 * Mark the current customer as "currently being viewed by me" and keep the
 * server-side TAKE flip alive with a heartbeat. On phone change or unmount,
 * explicitly release so the order status reverts to its prior state.
 *
 * Designed to be called from CallsPage with the active selectedPhone.
 * No-op when phone is empty.
 */
export function useActiveCallView(phone: string | undefined) {
  const qc = useQueryClient();
  const heldRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const target = phone && phone.replace(/\D/g, '').length >= 6 ? phone : null;

    const release = async (p: string) => {
      try {
        await apiReleaseActiveView(p);
      } catch {
        // best effort — server 2-min expiry + the new "release others on new heartbeat" logic are safety nets
      } finally {
        qc.invalidateQueries({ queryKey: ['active-view-lookup'] });
        qc.invalidateQueries({ queryKey: ['customer-history'] });
      }
    };

    // Phone changed — release the old hold first.
    if (heldRef.current && heldRef.current !== target) {
      const prev = heldRef.current;
      heldRef.current = null;
      void release(prev);
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!target) return;

    const beat = async () => {
      try {
        await apiHeartbeatActiveView(target);
        heldRef.current = target;
        qc.invalidateQueries({ queryKey: ['active-view-lookup', target] });
        qc.invalidateQueries({ queryKey: ['customer-history', target] });
      } catch { /* swallow — next tick will retry */ }
    };

    void beat();
    timerRef.current = setInterval(beat, HEARTBEAT_MS);

    // Best-effort beforeunload release (browsers may suppress async work,
    // but the server-side 2-min sweep catches anything we miss).
    const onBeforeUnload = () => {
      if (heldRef.current) {
        try {
          navigator.sendBeacon?.(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api/active-call-views/by-phone/${encodeURIComponent(heldRef.current)}`,
            new Blob([JSON.stringify({})], { type: 'application/json' }),
          );
        } catch { /* ignore */ }
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (heldRef.current) {
        const prev = heldRef.current;
        heldRef.current = null;
        void release(prev);
      }
    };
  }, [phone, qc]);
}
