import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, Check, X, Trash2, PhoneOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { CancellationReasonPicker } from '@/components/CancellationReasonPicker';
import { isCancelSelectionValid } from '@/lib/cancellationReasons';
import type { CancellationReason } from '@/lib/api';
import { cn } from '@/lib/utils';
import { hoverLift, getStaggerStyle } from '@/lib/design-utils';

// Stable keys; the KEY is stored structurally on the trashed order
// (orders.trash_reason) and translated for display — exactly like
// cancellation_reason. The optional free-text note goes to trash_reason_notes.
// 'not_reachable' is also the server-only auto-trash reason (9 consecutive
// no-answers). Exposing it here lets an agent trash a client as Unreachable by
// hand; the engine treats a not_reachable trash exactly like the auto path
// (removed from every calling band, parked in the Trash List).
const TRASH_REASON_KEYS = ['wrong_number', 'wrong_person', 'not_reachable', 'rude', 'uncooperative', 'other'];

type Outcome = 'confirmed' | 'cancel' | 'trash' | 'call_again';

interface Props {
  disabled?: boolean;
  /** Extra classes for the trigger button (e.g. to widen/centre it). */
  className?: string;
  /** Customer ordered → open the create-order modal (status forced confirmed). */
  onConfirmed: () => void;
  /** Customer declined → record a cancelled order with reason + note. */
  onCancelled: (reason: CancellationReason, notes: string) => Promise<void> | void;
  /** Wrong number / rude / etc → record a trashed order with the structured reason key + optional note. */
  onTrashed: (reasonKey: string, notes: string) => Promise<void> | void;
  /** No pickup → move to Call Again (today). */
  onDidntAnswer: () => Promise<void> | void;
}

// Labels/hints resolved at render via t(`chooseAnswer.outcome…`).
const OUTCOMES: { id: Outcome; labelKey: string; hintKey: string; icon: typeof Check; selected: string; idle: string }[] = [
  { id: 'confirmed',  labelKey: 'chooseAnswer.outcomeConfirmed', hintKey: 'chooseAnswer.outcomeConfirmedHint', icon: Check,    selected: 'bg-emerald-600 text-white border-emerald-600', idle: 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10' },
  { id: 'cancel',     labelKey: 'chooseAnswer.outcomeCancel',    hintKey: 'chooseAnswer.outcomeCancelHint',    icon: X,        selected: 'bg-rose-600 text-white border-rose-600',       idle: 'border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10' },
  { id: 'trash',      labelKey: 'chooseAnswer.outcomeTrash',     hintKey: 'chooseAnswer.outcomeTrashHint',     icon: Trash2,   selected: 'bg-zinc-800 text-white border-zinc-800',       idle: 'border-zinc-300 text-zinc-800 hover:bg-zinc-100 dark:border-zinc-500/40 dark:text-zinc-200 dark:hover:bg-zinc-500/10' },
  { id: 'call_again', labelKey: 'chooseAnswer.outcomeCallAgain', hintKey: 'chooseAnswer.outcomeCallAgainHint', icon: PhoneOff, selected: 'bg-amber-500 text-white border-amber-500',     idle: 'border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10' },
];

/**
 * "Choose Answer" — the manual outcome picker the agent uses after an external
 * call. A centered two-pane modal: the four outcomes on the left, the matching
 * reason form on the right. Only Confirmed opens the order modal.
 */
export function ChooseAnswerButton({ disabled, className, onConfirmed, onCancelled, onTrashed, onDidntAnswer }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [cancelReason, setCancelReason] = useState<CancellationReason | null>(null);
  const [cancelNotes, setCancelNotes] = useState('');
  const [trashReason, setTrashReason] = useState<string | null>(null);
  const [trashNotes, setTrashNotes] = useState('');

  const reset = () => {
    setOutcome(null);
    setCancelReason(null);
    setCancelNotes('');
    setTrashReason(null);
    setTrashNotes('');
    setSubmitting(false);
  };

  const close = () => { setOpen(false); reset(); };

  const run = async (fn: () => Promise<void> | void) => {
    setSubmitting(true);
    try { await fn(); close(); }
    finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          disabled={disabled}
          variant="outline"
          className={cn(
            'h-9 gap-1.5 text-sm border-orange-500 text-orange-600 bg-transparent hover:bg-orange-50 hover:-translate-y-[1px] dark:text-orange-300 dark:hover:bg-orange-500/10',
            className
          )}
        >
          <ClipboardCheck className="h-3.5 w-3.5" /> {t('chooseAnswer.button')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('chooseAnswer.dialogTitle')}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-[210px_1fr] gap-4">
          {/* Left — pick the outcome (premium calmer style) */}
          <div className="flex flex-col gap-2">
            {OUTCOMES.map((o, index) => {
              const Icon = o.icon;
              const active = outcome === o.id;

              // Distinct semantic colors so agents instantly know what each means
              const outcomeStyles: Record<Outcome, { active: string; idle: string; iconBg: string }> = {
                confirmed: {
                  active: 'border-[hsl(var(--success))] bg-[hsl(var(--success))] text-white shadow-sm',
                  idle: 'border-[hsl(var(--success))]/40 hover:border-[hsl(var(--success))]/60 bg-card',
                  iconBg: active ? 'bg-white/20' : 'bg-[hsl(var(--success))]/10',
                },
                cancel: {
                  active: 'border-destructive bg-destructive text-white shadow-sm',
                  idle: 'border-destructive/40 hover:border-destructive/60 bg-card',
                  iconBg: active ? 'bg-white/20' : 'bg-destructive/10',
                },
                trash: {
                  active: 'border-muted-foreground bg-muted-foreground text-white shadow-sm',
                  idle: 'border-border/60 hover:border-muted-foreground/60 bg-card',
                  iconBg: active ? 'bg-white/20' : 'bg-muted',
                },
                call_again: {
                  active: 'border-[hsl(var(--warning))] bg-[hsl(var(--warning))] text-white shadow-sm',
                  idle: 'border-[hsl(var(--warning))]/40 hover:border-[hsl(var(--warning))]/60 bg-card',
                  iconBg: active ? 'bg-white/20' : 'bg-[hsl(var(--warning))]/10',
                },
              };

              const style = outcomeStyles[o.id];

              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setOutcome(o.id)}
                  className={cn(
                    'w-full rounded-xl border px-4 py-3 text-left transition-all duration-200 flex items-start gap-3 group',
                    'hover:-translate-y-[1px] hover:shadow-sm',
                    active ? style.active : style.idle
                  )}
                  style={getStaggerStyle(index, 40)}
                >
                  <div className={cn(
                    "mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                    style.iconBg
                  )}>
                    <Icon className={cn("h-4 w-4", active ? "text-white" : "text-muted-foreground group-hover:text-foreground")} />
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <div className={cn("text-sm font-semibold", active ? "text-white" : "text-card-foreground")}>
                      {t(o.labelKey)}
                    </div>
                    <div className={cn("text-[12px] leading-tight mt-0.5", active ? "text-white/80" : "text-muted-foreground")}>
                      {t(o.hintKey)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right — reason / confirmation for the selected outcome */}
          <div className="rounded-lg border bg-muted/20 p-4 min-h-[240px] flex flex-col">
            {outcome === null && (
              <div className="m-auto text-center text-sm text-muted-foreground">
                {t('chooseAnswer.pickOutcomeHint')}
              </div>
            )}

            {outcome === 'confirmed' && (
              <div className="flex flex-col h-full">
                <p className="text-sm text-muted-foreground">
                  {t('chooseAnswer.confirmedDesc')}
                </p>
                <Button
                  className="mt-auto w-full gap-1.5"
                  onClick={() => { close(); onConfirmed(); }}
                >
                  <Check className="h-4 w-4" /> {t('chooseAnswer.createOrder')}
                </Button>
              </div>
            )}

            {outcome === 'cancel' && (
              <div className="flex flex-col h-full gap-3">
                <CancellationReasonPicker
                  value={cancelReason}
                  notes={cancelNotes}
                  onChange={setCancelReason}
                  onNotesChange={setCancelNotes}
                />
                <Button
                  variant="destructive"
                  className="mt-auto w-full gap-1.5"
                  disabled={!isCancelSelectionValid(cancelReason, cancelNotes) || submitting}
                  onClick={() => cancelReason && run(() => onCancelled(cancelReason, cancelNotes.trim()))}
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  {t('chooseAnswer.saveCancellation')}
                </Button>
              </div>
            )}

            {outcome === 'trash' && (
              <div className="flex flex-col h-full gap-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('chooseAnswer.trashReasonLabel')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {TRASH_REASON_KEYS.map(k => {
                    const label = t(`trashReason.${k}`);
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setTrashReason(k)}
                        className={cn(
                          'px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors',
                          trashReason === k
                            ? 'bg-muted-foreground text-white border-muted-foreground'
                            : 'bg-card text-muted-foreground border-border hover:border-muted-foreground/60',
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <Textarea
                  value={trashNotes}
                  onChange={e => setTrashNotes(e.target.value)}
                  placeholder={trashReason === 'other' ? t('chooseAnswer.otherRequiredPlaceholder') : t('chooseAnswer.optionalNote')}
                  className="min-h-[60px] text-xs"
                  maxLength={1000}
                />
                <Button
                  variant="secondary"
                  className="mt-auto w-full gap-1.5"
                  disabled={!trashReason || (trashReason === 'other' && !trashNotes.trim()) || submitting}
                  onClick={() => trashReason && run(() => onTrashed(trashReason, trashNotes.trim()))}
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  {t('chooseAnswer.saveTrash')}
                </Button>
              </div>
            )}

            {outcome === 'call_again' && (
              <div className="flex flex-col h-full">
                <p className="text-sm text-muted-foreground">
                  {t('chooseAnswer.callAgainDesc')}
                </p>
                <Button
                  className="mt-auto w-full gap-1.5"
                  disabled={submitting}
                  onClick={() => run(onDidntAnswer)}
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneOff className="h-4 w-4" />}
                  {t('chooseAnswer.moveToCallAgain')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
