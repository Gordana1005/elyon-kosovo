import i18n from '@/i18n';
import { cancelReasonLabel } from '@/lib/cancellationReasons';
import { cleanNoteForDisplay } from '@/lib/notes';

// Why a terminated order ended where it did, as one line of human text.
//
// The reason is spread over three column pairs — cancellation_reason,
// trash_reason and return_reason, each with its own free-text _notes — and
// before this helper existed every surface stitched them together slightly
// differently. The orders table read the notes but never the coded reason; the
// customer history read the coded reason but only some of the notes; the
// status badge showed nothing at all. Same order, three answers.
//
// One function, used by every one of them, so "Cancelled" means the same thing
// wherever it is displayed.
//
// Shape is "<coded reason> — <what the agent actually typed>", with either half
// omitted when absent:
//     Ќе размисли — се јави откажа
//     Се јави погрешно лице
//     duplicate — веќе има нарачано
export function orderReasonText(order: any): string | null {
  if (!order) return null;

  const pick = (): { label: string | null; notes: string } => {
    if (order.status === 'trashed') {
      return {
        label: order.trash_reason
          ? i18n.t(`trashReason.${order.trash_reason}`, { defaultValue: String(order.trash_reason).replace(/_/g, ' ') })
          : null,
        notes: order.trash_reason_notes || '',
      };
    }
    if (order.status === 'returned') {
      return {
        label: order.return_reason
          ? i18n.t(`returnReason.${order.return_reason}`, { defaultValue: String(order.return_reason).replace(/_/g, ' ') })
          : null,
        notes: order.return_reason_notes || '',
      };
    }
    // Cancelled, and anything else that carries a cancellation reason.
    return {
      label: order.cancellation_reason ? cancelReasonLabel(order.cancellation_reason) : null,
      notes: order.cancellation_reason_notes || '',
    };
  };

  const { label, notes } = pick();
  const clean = cleanNoteForDisplay(notes || '').replace(/\s+/g, ' ').trim();

  // The imported AlterCPA history writes "<original disposition> — <comment>"
  // into the notes when the disposition had no CRM equivalent, so a coded
  // reason of 'other' would otherwise render as "Друго — duplicate — ...".
  if (!label) return clean || null;
  if (!clean) return label;
  if (clean.toLowerCase().startsWith(label.toLowerCase())) return clean;
  return `${label} — ${clean}`;
}

// The full tooltip for a status chip: the status word plus its reason. Returns
// undefined for statuses that have no reason to explain, so the badge simply
// does not get a title attribute rather than getting an empty one.
export function statusTooltip(order: any, statusText: string): string | undefined {
  const reason = orderReasonText(order);
  return reason ? `${statusText} — ${reason}` : undefined;
}
