import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { apiBigArenaSync } from '@/lib/api';
import { STATUS_COLORS } from '@/types';
import * as XLSX from 'xlsx';
import {
  Upload,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Truck,
} from 'lucide-react';

// BigArena action-button labels that appear in EVERY pending order's row. They
// contain "отказ" (cancel) and "върни" (return) and used to be mis-read as the
// order's status — flipping pending/shipped orders to "returned" by mistake.
// We strip them before any keyword check. (Mirror this list in the backend.)
const BIGARENA_ACTION_LABELS = [
  'принудително отказване',
  'върни обратно за повторна обработка',
  'създай поръчка за замяна',
  'клонирай поръчка',
  'маркирай като изчерпана наличност',
  'промени наложен платеж',
  'придвижи за приоритетно изпълнение',
  'генерирай пратка',
  'прегенерирай пратка',
  'история на статусите',
  'добави инфо за куриер',
];

function stripBigArenaActions(s: string): string {
  let out = (s || '').toLowerCase();
  for (const a of BIGARENA_ACTION_LABELS) out = out.split(a).join(' ');
  return out;
}

// Conservative client-side mirror of the backend map (used only for preview labels).
// Precise + safe: only genuine terminal statuses move an order. Pending /
// in-movement / processing (Неизпълнена, На изпълнение, Резервира, В движение,
// Пакетирана, Предадена на куриер) → no change. Extend phrases with the operator.
function previewMapBigArenaStatus(raw: string): 'paid' | 'returned' | 'cancelled' | 'shipped' {
  const s = stripBigArenaActions(raw);

  // Paid — client physically accepted the parcel / merchant got paid.
  if (
    s.includes('приета от клиент') || s.includes('приет от клиент') ||
    s.includes('доставен') || s.includes('доставена') ||
    /дата на изплащане/.test(s) || s.includes('платен')
  ) return 'paid';

  // Cancelled — "Отменена" / "Анулирана" (cancelled/voided at the warehouse,
  // never shipped out → no stock restore). Maps to CRM 'cancelled', NOT 'returned'.
  if (s.includes('отменен') || s.includes('анулиран')) return 'cancelled';

  // Returned — a parcel that actually went out and came back / was refused /
  // failed delivery. (Action labels already stripped, so "отказана"/"върната"
  // here are real statuses, not buttons.) NOTE: "Неуспешна доставка" (failed
  // delivery) IS a return, but a single "неуспешен опит" (failed attempt) is
  // NOT — the courier retries — so we do not match that.
  if (
    s.includes('върнат') || s.includes('върната') ||
    s.includes('отказана') || s.includes('отказан от клиент') ||
    s.includes('неуспешна доставка') ||
    s.includes('не е потърсена') || s.includes('return')
  ) return 'returned';

  // Everything else (pending / in-movement / processing) — leave as shipped.
  return 'shipped';
}

interface ParsedRow {
  ref: string;
  rawStatus: string;
  target: 'paid' | 'returned' | 'cancelled' | 'shipped';
  originalLine?: string;
}

interface SyncResult {
  success: boolean;
  updated: { paid: number; returned: number; cancelled: number };
  skipped: Array<{ ref?: string; display_id?: string; reason: string }>;
  matched: number;
  unmatchedRefs: string[];
}

interface BigArenaStatusSyncProps {
  onSuccess?: () => void;
  compact?: boolean; // smaller trigger for sidebars
}

export function BigArenaStatusSync({ onSuccess, compact = false }: BigArenaStatusSyncProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const canUse = user?.isAdmin || user?.isManager || user?.isWarehouse;

  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canUse) return null;

  const reset = () => {
    setFileName('');
    setParsed([]);
    setResult(null);
    setError(null);
  };

  const handleClose = () => {
    setOpen(false);
    // keep result visible until user explicitly resets or closes fully
  };

  const parseFile = async (file: File) => {
    setIsParsing(true);
    setError(null);
    setParsed([]);
    setResult(null);
    setFileName(file.name);

    try {
      const ext = file.name.toLowerCase().split('.').pop();
      let rows: unknown[] = [];

      if (ext === 'xlsx' || ext === 'xls') {
        const data = await file.arrayBuffer();
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as unknown[];

        // Guard: detect the BigArena Fulfillment/Stock Panel export (product inventory)
        // vs the Order Tracking/Status export the parser is designed for.
        if (rows.length > 0) {
          const headerText = (rows[0] as any[]).map(c => String(c || '')).join(' ').toLowerCase();
          if (
            headerText.includes('наименование') &&
            headerText.includes('информация') &&
            (headerText.includes('количество') || headerText.includes('наличност'))
          ) {
            setError('This file looks like the BigArena "Fulfillment Panel" (product stock / inventory) export, not the order tracking or status export. The status sync tool only works with order list exports that contain "Поръчка" / "Ref:" numbers and delivery statuses. Please export the correct order tracking view from BigArena.');
            setParsed([]);
            setIsParsing(false);
            return;
          }
        }
      } else {
        // CSV / TXT — tolerant read (UTF-8 first; user can re-save if mojibake)
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(Boolean);
        // Very tolerant: treat every line as one blob (the BigArena export is often one giant quoted field per row)
        rows = lines.map((line, idx) => ({ __line: idx, __raw: line }));
      }

      const work: ParsedRow[] = [];

      for (const r of rows) {
        const blob = typeof r === 'string'
          ? r
          : (r.__raw || Object.values(r).join(' ') || '');

        // Extract Ref (the key we care about — matches numeric part of our display_id)
        const refMatch = blob.match(/Ref:\s*(\d{4,6})/i) || blob.match(/Поръчка[^0-9]*(\d{4,6})/i);
        const ref = refMatch ? refMatch[1] : '';

        if (!ref) continue;

        // Status extraction - prefer specific columns when we have the common Fulfillment Panel format
        let rawStatus = '';
        if (typeof r === 'object' && Array.isArray(r)) {
          // This is the standard BigArena Fulfillment Panel order export
          // Column 3 (0-based) = "Статус" (main status like "Пакетирана В движение...")
          // Column 5 = "Статус на изпълнение"
          // Column 6 = "Плащания" (often contains "CompleteИзпълнена" + payment info)
          const colStatus = String(r[3] || '');
          const colIzpulnenie = String(r[5] || '');
          const colPlashtania = String(r[6] || '');

          rawStatus = [colStatus, colIzpulnenie, colPlashtania].filter(Boolean).join(' ');
        }

        if (!rawStatus) {
          // Fallback for messy CSV (one giant quoted field per row). Strip the
          // action-button labels FIRST so the snippet picker can't grab
          // "отказване"/"върни обратно" from a button and read it as a status.
          const cleanBlob = stripBigArenaActions(blob);
          const statusMatch = cleanBlob.match(/пакетирана[^"]{0,80}/i) ||
                              cleanBlob.match(/в движение[^"]{0,60}/i) ||
                              cleanBlob.match(/приета от клиент[^"]{0,40}/i) ||
                              cleanBlob.match(/готова за получаване[^"]{0,40}/i) ||
                              cleanBlob.match(/на изпълнение[^"]{0,60}/i) ||
                              cleanBlob.match(/върнат[ао]?[^"]{0,40}/i) ||
                              cleanBlob.match(/отменен[ао]?[^"]{0,40}/i);
          rawStatus = statusMatch ? statusMatch[0] : cleanBlob.slice(0, 200);
        }

        const target = previewMapBigArenaStatus(rawStatus);
        work.push({ ref, rawStatus: rawStatus.trim().slice(0, 120), target, originalLine: blob.slice(0, 300) });
      }

      // Dedupe by ref (last one wins — typical for "last N orders" exports)
      const seen = new Set<string>();
      const deduped = work.filter(row => {
        if (seen.has(row.ref)) return false;
        seen.add(row.ref);
        return true;
      });

      if (deduped.length === 0) {
        setError('No rows with recognizable "Ref: NNNNN" found. Make sure you exported the order tracking view from BigArena.');
      }

      setParsed(deduped.slice(0, 500)); // hard safety cap for UI
    } catch (e: unknown) {
      console.error(e);
      const msg = (e as { message?: string })?.message || 'Failed to parse file. Try saving the CSV from Excel as UTF-8 or export as XLSX from BigArena.';
      setError(msg);
    } finally {
      setIsParsing(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) parseFile(f);
    e.target.value = ''; // allow re-select same file
  };

  const paidCount = parsed.filter(r => r.target === 'paid').length;
  const returnedCount = parsed.filter(r => r.target === 'returned').length;
  const cancelledCount = parsed.filter(r => r.target === 'cancelled').length;
  const noChangeCount = parsed.length - paidCount - returnedCount - cancelledCount;
  const changeCount = paidCount + returnedCount + cancelledCount;

  const handleApply = async () => {
    if (parsed.length === 0) return;
    setIsApplying(true);
    setError(null);

    try {
      const payload = parsed
        .filter(r => r.target !== 'shipped')
        .map(r => ({
          ref: r.ref,
          rawStatus: r.rawStatus,
          targetStatus: r.target as 'paid' | 'returned' | 'cancelled',
        }));

      if (payload.length === 0) {
        toast({ title: t('bigArena.nothingToApply'), description: t('bigArena.allInTransit') });
        setIsApplying(false);
        return;
      }

      const res = await apiBigArenaSync(payload, {
        filename: fileName,
        uploadedAt: new Date().toISOString(),
      });

      const syncResult: SyncResult = {
        success: !!res?.success,
        updated: { paid: 0, returned: 0, cancelled: 0, ...(res?.updated || {}) },
        skipped: res?.skipped || [],
        matched: res?.matched || 0,
        unmatchedRefs: res?.unmatchedRefs || [],
      };
      setResult(syncResult);

      if (syncResult.updated.paid + syncResult.updated.returned + syncResult.updated.cancelled > 0) {
        toast({
          title: t('bigArena.syncComplete'),
          description: t('bigArena.syncCompleteDesc', { paid: syncResult.updated.paid, returned: syncResult.updated.returned, cancelled: syncResult.updated.cancelled }),
        });
        onSuccess?.();
      } else {
        toast({ title: t('bigArena.syncFinished'), description: t('bigArena.noQualified') });
      }
    } catch (e: unknown) {
      const msg = ((e as { message?: string })?.message) || t('bigArena.syncFailed');
      setError(msg);
      toast({ title: t('bigArena.syncError'), description: msg, variant: 'destructive' });
    } finally {
      setIsApplying(false);
    }
  };

  const triggerButton = compact ? (
    <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
      <Truck className="h-3.5 w-3.5" /> BigArena Sync
    </Button>
  ) : (
    <Button variant="outline" onClick={() => setOpen(true)} className="gap-2">
      <Upload className="h-4 w-4" /> BigArena Status CSV / XLSX
    </Button>
  );

  return (
    <>
      {triggerButton}

      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true); }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" /> {t('bigArena.dialogTitle')}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              {t('bigArena.dialogDesc')}
            </p>
          </DialogHeader>

          <div className="flex-1 overflow-auto space-y-4 pr-1">
            {/* Upload zone */}
            {!parsed.length && !result && (
              <div className="border-2 border-dashed rounded-xl p-8 text-center">
                <input
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls"
                  onChange={onFileChange}
                  className="hidden"
                  id="bigarena-upload"
                />
                <label htmlFor="bigarena-upload" className="cursor-pointer">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Upload className="h-6 w-6" />
                  </div>
                  <div className="font-medium">{t('bigArena.dropUpload')}</div>
                  <div className="text-xs text-muted-foreground mt-1">{t('bigArena.fileHint')}</div>
                </label>
                {isParsing && <div className="mt-3 text-sm flex items-center justify-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> {t('bigArena.parsing')}</div>}
              </div>
            )}

            {fileName && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" /> {fileName}
                <Button variant="ghost" size="sm" onClick={reset} className="h-6 px-2">{t('bigArena.changeFile')}</Button>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5" /> {error}
              </div>
            )}

            {/* Preview */}
            {parsed.length > 0 && !result && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-semibold">{parsed.length}</span> {t('bigArena.rowsParsed')} •
                    <span className="text-emerald-600 ml-1">{paidCount} → {t('status.paid')}</span> •
                    <span className="text-pink-500 ml-1">{returnedCount} → {t('status.returned')}</span> •
                    <span className="text-rose-600 ml-1">{cancelledCount} → {t('status.cancelled')}</span> •
                    <span className="text-blue-500 ml-1">{t('bigArena.stayShipped', { count: noChangeCount })}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">{t('bigArena.onlyShippedMove')}</div>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <div className="max-h-[320px] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">{t('bigArena.colRef')}</th>
                          <th className="px-3 py-2 text-left font-medium">{t('bigArena.colDetected')}</th>
                          <th className="px-3 py-2 text-left font-medium w-28">{t('bigArena.colAction')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {parsed.map((row, i) => (
                          <tr key={i} className="hover:bg-muted/40">
                            <td className="px-3 py-1.5 font-mono text-xs font-semibold">{row.ref}</td>
                            <td className="px-3 py-1.5 text-xs text-muted-foreground truncate max-w-[420px]" title={row.originalLine}>
                              {row.rawStatus || '—'}
                            </td>
                            <td className="px-3 py-1.5">
                              {row.target === 'paid' && <Badge className={STATUS_COLORS.paid}>→ {t('status.paid')}</Badge>}
                              {row.target === 'returned' && <Badge className={STATUS_COLORS.returned}>→ {t('status.returned')}</Badge>}
                              {row.target === 'cancelled' && <Badge className={STATUS_COLORS.cancelled}>→ {t('status.cancelled')}</Badge>}
                              {row.target === 'shipped' && <Badge className={STATUS_COLORS.shipped}>{t('bigArena.noChange')}</Badge>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t('bigArena.previewOnly')}
                </p>
              </>
            )}

            {/* Result report */}
            {result && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-lg font-semibold">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" /> {t('bigArena.syncCompleteHeader')}
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <div className="rounded-lg border p-3">
                    <div className="text-2xl font-semibold text-emerald-600">{result.updated.paid}</div>
                    <div className="text-sm">{t('bigArena.movedToPaid')}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-2xl font-semibold text-pink-500">{result.updated.returned}</div>
                    <div className="text-sm">{t('bigArena.movedToReturned')}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-2xl font-semibold text-rose-600">{result.updated.cancelled}</div>
                    <div className="text-sm">{t('bigArena.movedToCancelled')}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-2xl font-semibold">{result.skipped.length}</div>
                    <div className="text-sm">{t('bigArena.skippedDesc')}</div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                  {t('bigArena.recordedNote')}
                </div>

                {result.unmatchedRefs?.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {t('bigArena.unmatchedRefs', { refs: result.unmatchedRefs.slice(0, 12).join(', ') })}
                    {result.unmatchedRefs.length > 12 && t('bigArena.moreCount', { count: result.unmatchedRefs.length - 12 })}
                  </div>
                )}

                {result.skipped?.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">{t('bigArena.showSkipped', { count: result.skipped.length })}</summary>
                    <div className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 font-mono text-[10px]">
                      {result.skipped.slice(0, 30).map((s, i) => (
                        <div key={i}>{s.ref || s.display_id || '?'} — {s.reason}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            {parsed.length > 0 && !result && (
              <Button onClick={handleApply} disabled={isApplying || (changeCount === 0)} className="gap-2">
                {isApplying ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {t('bigArena.applyUpdates', { count: changeCount })}
              </Button>
            )}
            {result && (
              <Button onClick={() => { reset(); setOpen(false); }} variant="outline">{t('bigArena.done')}</Button>
            )}
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
