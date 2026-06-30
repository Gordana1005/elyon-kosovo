import { DateTime } from 'luxon';
import { config } from '../config';

const ZONE = config.tz;

export interface DayRange {
  startISO: string; // inclusive (UTC)
  endISO: string; // exclusive (UTC)
  label: string;
}

/** A single day [00:00, next 00:00) in the bot timezone (default Europe/Belgrade). */
export function sofiaDay(dateStr?: string): DayRange {
  const base = dateStr ? DateTime.fromISO(dateStr, { zone: ZONE }) : DateTime.now().setZone(ZONE);
  if (!base.isValid) throw new Error(`Invalid date "${dateStr}" — use YYYY-MM-DD`);
  const start = base.startOf('day');
  const end = start.plus({ days: 1 });
  return { startISO: start.toUTC().toISO()!, endISO: end.toUTC().toISO()!, label: start.toFormat('yyyy-LL-dd') };
}

/** An inclusive date range [from 00:00, to+1 00:00) in the bot timezone. */
export function sofiaRange(fromStr: string, toStr: string): DayRange {
  const from = DateTime.fromISO(fromStr, { zone: ZONE });
  const to = DateTime.fromISO(toStr, { zone: ZONE });
  if (!from.isValid) throw new Error(`Invalid from-date "${fromStr}" — use YYYY-MM-DD`);
  if (!to.isValid) throw new Error(`Invalid to-date "${toStr}" — use YYYY-MM-DD`);
  const start = from.startOf('day');
  const end = to.startOf('day').plus({ days: 1 });
  return {
    startISO: start.toUTC().toISO()!,
    endISO: end.toUTC().toISO()!,
    label: `${start.toFormat('yyyy-LL-dd')} → ${to.startOf('day').toFormat('yyyy-LL-dd')}`,
  };
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = DateTime.fromISO(iso).setZone(ZONE);
  return d.isValid ? d.toFormat('dd LLL yyyy, HH:mm') : '—';
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = DateTime.fromISO(iso).setZone(ZONE);
  return d.isValid ? d.toFormat('dd LLL yyyy') : '—';
}

export function todayLabel(): string {
  return DateTime.now().setZone(ZONE).toFormat('yyyy-LL-dd');
}

export function fmtDuration(totalSeconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
