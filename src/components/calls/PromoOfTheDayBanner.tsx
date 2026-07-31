import { useTranslation, Trans } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Flame } from 'lucide-react';
import { apiGetPromoOfTheDay, type PromoStatus } from '@/lib/api';
import { formatMoney, formatPriceInline } from '@/lib/currency';
import { plainPromoText, renderPromoText, resolveCustomText } from '@/lib/promoText';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

/** Query key — CallsPage invalidates it after a confirm so the counter ticks up. */
export const PROMO_QUERY_KEY = ['promo-of-the-day'] as const;

/**
 * "Product of the Day" — the operator's motivational promo, shown to agents on
 * /calls next to Choose Answer. Configured from Call Scripts → Promo.
 *
 * Display-only by design: the counter is recomputed live from today's orders,
 * nothing is stamped on an order and no payout is affected (the per-package
 * commission is a separate, untouched system — see elyon-agent-commissions).
 * The numbers shown are ALWAYS the caller's own; the server scopes them by the
 * JWT, so one agent can never read another's progress.
 */
export function PromoOfTheDayBanner({ className }: { className?: string }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const { data } = useQuery<PromoStatus>({
    queryKey: PROMO_QUERY_KEY,
    queryFn: apiGetPromoOfTheDay,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  if (!data?.active) return null;
  const { product_name, price_eur, bonus_eur, note, custom_text, my_orders_today, my_bonus_today } = data;
  const values = { product: product_name, price: formatMoney(price_eur), bonus: formatMoney(bonus_eur) };

  // The operator can override either line from Call Scripts → Promo, per
  // language. When they haven't, the built-in translated copy is used.
  const ownFull = resolveCustomText(custom_text, 'full');
  const ownShort = resolveCustomText(custom_text, 'short');
  const own = (text: string) => (
    <>{renderPromoText(text, values).map((p, i) => p.bold
      ? <strong key={i} className="font-semibold text-foreground">{p.text}</strong>
      : <span key={i}>{p.text}</span>)}</>
  );

  // The offer line carries the whole pitch; the product name and the two money
  // figures are the only bold parts so the eye lands on them mid-call.
  const offer = ownFull ? own(ownFull) : (
    <Trans
      i18nKey="promo.offer"
      values={values}
      components={{ b: <strong className="font-semibold text-foreground" /> }}
    />
  );
  // Desktop one-liner. Same promise, fewer words, so the strip stays as tall as
  // the button next to it — the full sentence is one hover (or one glance at a
  // phone) away. A custom short line falls back to the custom full one, so the
  // operator only has to write once if they don't care about the distinction.
  const shortSource = ownShort || ownFull;
  const offerShort = shortSource ? own(shortSource) : (
    <Trans
      i18nKey="promo.offerShort"
      values={values}
      components={{ b: <strong className="font-semibold text-foreground" /> }}
    />
  );
  const rule = t('promo.rule');
  const counter = my_orders_today > 0
    // `n`, not `count` — `count` would make i18next look for plural key variants.
    ? t('promo.today', { n: my_orders_today, total: formatMoney(my_bonus_today) })
    : t('promo.todayEmpty', { bonus: formatMoney(bonus_eur) });

  // Plain-text twin of the FULL offer — the desktop strip shows the short form,
  // so the tooltip is where the whole sentence (with the lev price) lives.
  const tooltipValues = { ...values, price: formatPriceInline(price_eur) };
  const plain = ownFull
    ? plainPromoText(ownFull, tooltipValues)
    : t('promo.offer', { ...tooltipValues, interpolation: { escapeValue: false } }).replace(/<\/?b>/g, '');

  const shell = cn(
    'rounded-xl border border-amber-400/60 bg-amber-50/80 dark:border-amber-500/40 dark:bg-amber-500/10',
    className,
  );
  const kicker = (
    <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
      <Flame className="h-3 w-3" /> {t('promo.kicker')}
    </span>
  );
  const chip = (
    <span className="shrink-0 rounded-lg bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
      {counter}
    </span>
  );

  // Mobile: a full-width card UNDER the Choose Answer button, inside the same
  // vertical stack — nothing floats, nothing can scroll the page sideways.
  if (isMobile) {
    return (
      <div className={cn(shell, 'w-full max-w-full px-3 py-2.5 space-y-1.5')}>
        {kicker}
        <p className="text-[13px] leading-snug text-muted-foreground break-words">{offer}</p>
        <p className="text-[11px] leading-snug text-muted-foreground/70 break-words">{rule}</p>
        {note && <p className="text-[11px] leading-snug text-muted-foreground/70 break-words">{note}</p>}
        <div>{chip}</div>
      </div>
    );
  }

  // Desktop: ONE horizontal strip — kicker, short offer and counter all on a
  // single line, so the banner spends the free width beside the button instead
  // of pushing the History cards down the page. It grows sideways, never
  // (meaningfully) taller than the Choose Answer button itself. The full
  // sentence, the up-sell rule and the lev price live in the tooltip; mobile
  // shows all of it spelled out.
  return (
    <div
      className={cn(shell, 'flex w-full items-center gap-2.5 px-3 py-1.5')}
      title={`${plain}\n${rule}${note ? `\n${note}` : ''}`}
    >
      {kicker}
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-muted-foreground break-words">{offerShort}</p>
      {chip}
    </div>
  );
}
