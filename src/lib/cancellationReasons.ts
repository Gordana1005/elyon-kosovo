import type { CancellationReason } from '@/lib/api';
import i18n from '@/i18n';

// Single source of truth for the cancellation reasons agents pick from.
// Used by BOTH input pickers — the order/call modal (CancellationReasonPicker)
// and the in-call widget (ActiveCallWidget) — so the list and its order can
// never drift between them again. The order here is the order operators see.
//
// `value` is what travels onto orders.cancellation_reason (constrained by the
// DB check + the zod enum in supabase/functions/api/index.ts — keep all three
// in sync). Display labels live in src/i18n/locales/*.json under
// "cancelReason.*" (active + retired reasons), so build options at render
// time via getCancelReasonOptions() — never at module level — and make sure
// the rendering component calls useTranslation() to re-render on switch.
export const CANCEL_REASON_VALUES: CancellationReason[] = [
  'not_satisfied',
  'price_too_high',
  'still_using_product',
  'changed_mind',
  'no_money',
  'not_interested',
  'bought_elsewhere',
  'will_call_back',
];

// Label for DISPLAY (pickers, history tabs, synthetic records). Covers the
// active values above plus retired reasons (family_refused, wrong_product,
// duplicate_order, other) that still exist on historical orders. Unknown
// values render as-is.
export const cancelReasonLabel = (value: string): string =>
  i18n.t(`cancelReason.${value}`, { defaultValue: value });

export const getCancelReasonOptions = (): { value: CancellationReason; label: string }[] =>
  CANCEL_REASON_VALUES.map(value => ({ value, label: cancelReasonLabel(value) }));
