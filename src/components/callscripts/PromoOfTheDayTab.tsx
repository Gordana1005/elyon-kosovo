import { useEffect, useMemo, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Flame, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ProductCombobox } from '@/components/ProductCombobox';
import { LangTabs } from '@/components/callscripts/LangTabs';
import { useToast } from '@/hooks/use-toast';
import { apiErrorText } from '@/i18n/apiErrors';
import i18n, { type AppLanguage } from '@/i18n';
import { BASE_SCRIPT_LANG } from '@/lib/callScripts';
import { apiGetAppSettings, apiGetProducts, apiUpdateAppSettings, type PromoConfig } from '@/lib/api';
import { formatMoney, formatPriceInline } from '@/lib/currency';
import { cleanCustomText, plainPromoText, renderPromoText, resolveCustomText } from '@/lib/promoText';

const EMPTY: PromoConfig = {
  enabled: false, product_id: null, product_name: '',
  price_eur: null, bonus_eur: null, expires_on: null, note: '', custom_text: {},
};

/**
 * Call Scripts → Promo. The operator picks the Product of the Day, the minimum
 * price it must be sold at, and the extra € an agent takes for up-selling it.
 *
 * Motivational only: nothing here feeds the payout ledger or the per-package
 * commission (elyon-agent-commissions). The agent-side counter is recomputed
 * live from the CURRENT settings, so editing the promo mid-day also re-scores
 * today — stated on screen so it is never a surprise.
 */
export function PromoOfTheDayTab({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [saved, setSaved] = useState<PromoConfig>(EMPTY);
  const [draft, setDraft] = useState<PromoConfig>(EMPTY);
  const [products, setProducts] = useState<any[]>([]);
  const [textLang, setTextLang] = useState<AppLanguage>(BASE_SCRIPT_LANG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([apiGetAppSettings().catch(() => null), apiGetProducts().catch(() => [])])
      .then(([settings, prods]) => {
        const cfg = { ...EMPTY, ...((settings?.promo_of_the_day as PromoConfig) || {}) };
        setSaved(cfg);
        setDraft(cfg);
        setProducts(Array.isArray(prods) ? prods : (prods as any)?.products || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const patch = (p: Partial<PromoConfig>) => setDraft(prev => ({ ...prev, ...p }));

  // ── Own wording, per language ──────────────────────────────────────────────
  const textFor = (lang: string, variant: 'short' | 'full') => draft.custom_text?.[lang]?.[variant] ?? '';
  const patchText = (lang: string, variant: 'short' | 'full', v: string) =>
    setDraft(prev => ({
      ...prev,
      custom_text: { ...(prev.custom_text || {}), [lang]: { ...((prev.custom_text || {})[lang] || {}), [variant]: v } },
    }));
  // The built-in copy in THAT language as a RAW template — read straight off the
  // resource bundle so the {{tokens}} survive un-interpolated, with the <b>
  // markup stripped, so it renders through the same token renderer the agent's
  // banner uses and the two can never drift apart.
  const defaultIn = (lang: string, key: 'offer' | 'offerShort'): string =>
    String(
      i18n.getResource(lang, 'translation', `promo.${key}`) ??
      i18n.getResource('en', 'translation', `promo.${key}`) ?? '',
    ).replace(/<\/?b>/g, '');
  // Placeholder = that same default, filled in — an empty field visibly means
  // "the default text, which reads like this".
  const filledDefault = (lang: string, key: 'offer' | 'offerShort') =>
    plainPromoText(defaultIn(lang, key), {
      product: previewName, price: formatMoney(draft.price_eur ?? 0), bonus: formatMoney(draft.bonus_eur ?? 0),
    });
  const defaultShortFor = (lang: string) => filledDefault(lang, 'offerShort');
  const defaultFullFor = (lang: string) => filledDefault(lang, 'offer');
  const langsWithText = Object.entries(draft.custom_text || {})
    .filter(([, v]) => (v?.short || '').trim() || (v?.full || '').trim())
    .map(([lang]) => lang);
  const numField = (v: string): number | null => {
    if (!v.trim()) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  // A promo can be saved half-finished as long as it stays OFF (a draft for
  // tomorrow); switching it ON demands the full offer — the same rule the API
  // enforces, mirrored here so the button explains itself before the round trip.
  const complete = !!draft.product_id && !!draft.price_eur && !!draft.bonus_eur;
  const canSave = isAdmin && dirty && (!draft.enabled || complete);

  const handleSave = async () => {
    setSaving(true);
    try {
      const productName = products.find(p => p.id === draft.product_id)?.name || draft.product_name;
      const payload: PromoConfig = {
        ...draft,
        product_name: productName,
        expires_on: draft.expires_on || null,
        custom_text: cleanCustomText(draft.custom_text),
      };
      await apiUpdateAppSettings({ promo_of_the_day: payload });
      setSaved(payload);
      setDraft(payload);
      toast({ title: t('promo.saved') });
    } catch (err: any) {
      toast({ title: t('common.error'), description: apiErrorText(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // One preview line, resolved exactly like the agent's banner does: the
  // operator's own wording for this language if there is any (short falls back
  // to full), otherwise the built-in copy — with the money values bolded.
  const previewLine = (variant: 'short' | 'full') => {
    const own = variant === 'short'
      ? (resolveCustomText(draft.custom_text, 'short', textLang) || resolveCustomText(draft.custom_text, 'full', textLang))
      : resolveCustomText(draft.custom_text, 'full', textLang);
    const text = own || defaultIn(textLang, variant === 'short' ? 'offerShort' : 'offer');
    return renderPromoText(text, {
      product: previewName,
      price: formatMoney(draft.price_eur ?? 0),
      bonus: formatMoney(draft.bonus_eur ?? 0),
    }).map((p, i) => p.bold
      ? <strong key={i} className="font-semibold text-foreground">{p.text}</strong>
      : <span key={i}>{p.text}</span>);
  };

  const previewName = useMemo(
    () => products.find(p => p.id === draft.product_id)?.name || draft.product_name || t('promo.previewProduct'),
    [products, draft.product_id, draft.product_name, t],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Flame className="h-4 w-4 text-amber-500" /> {t('promo.adminTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">{t('promo.adminDesc')}</p>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
              <div>
                <Label className="text-sm font-semibold">{t('promo.enabledLabel')}</Label>
                <p className="text-[11px] text-muted-foreground">{t('promo.enabledHint')}</p>
              </div>
              <Switch
                checked={draft.enabled}
                onCheckedChange={v => patch({ enabled: v })}
                disabled={!isAdmin}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">{t('promo.productLabel')}</Label>
              <ProductCombobox
                products={products}
                value={draft.product_id}
                productName={draft.product_name}
                onChange={id => patch({ product_id: id, product_name: products.find(p => p.id === id)?.name || '' })}
                disabled={!isAdmin}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">{t('promo.priceLabel')}</Label>
                <Input
                  type="number" step="0.01" min="0" inputMode="decimal"
                  value={draft.price_eur ?? ''}
                  onChange={e => patch({ price_eur: numField(e.target.value) })}
                  disabled={!isAdmin} className="h-9"
                />
                <p className="text-[10px] text-muted-foreground">{t('promo.priceHint')}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">{t('promo.bonusLabel')}</Label>
                <Input
                  type="number" step="0.01" min="0" inputMode="decimal"
                  value={draft.bonus_eur ?? ''}
                  onChange={e => patch({ bonus_eur: numField(e.target.value) })}
                  disabled={!isAdmin} className="h-9"
                />
                <p className="text-[10px] text-muted-foreground">{t('promo.bonusHint')}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">{t('promo.expiresLabel')}</Label>
                <Input
                  type="date"
                  value={draft.expires_on || ''}
                  onChange={e => patch({ expires_on: e.target.value || null })}
                  disabled={!isAdmin} className="h-9"
                />
                <p className="text-[10px] text-muted-foreground">{t('promo.expiresHint')}</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                {t('promo.noteLabel')} <span className="font-normal text-muted-foreground">{t('callScripts.optionalSuffix')}</span>
              </Label>
              <Input
                value={draft.note || ''}
                onChange={e => patch({ note: e.target.value })}
                placeholder={t('promo.notePlaceholder')}
                disabled={!isAdmin} className="h-9"
              />
            </div>

            {/* Own wording — optional, per language, empty = the default text. */}
            <div className="space-y-2 border-t border-border/60 pt-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <Label className="text-xs font-semibold">
                    {t('promo.textLabel')} <span className="font-normal text-muted-foreground">{t('callScripts.optionalSuffix')}</span>
                  </Label>
                  <p className="text-[11px] text-muted-foreground">{t('promo.textHint')}</p>
                </div>
                <LangTabs value={textLang} onChange={setTextLang} present={langsWithText} />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(['product', 'price', 'bonus'] as const).map(tok => (
                  <code key={tok} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                    {`{{${tok}}}`}
                  </code>
                ))}
                <span className="text-[10px] text-muted-foreground">{t('promo.tokensHint')}</span>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">{t('promo.textShortLabel')}</Label>
                <Input
                  value={textFor(textLang, 'short')}
                  onChange={e => patchText(textLang, 'short', e.target.value)}
                  placeholder={defaultShortFor(textLang)}
                  disabled={!isAdmin} className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">{t('promo.textFullLabel')}</Label>
                <Textarea
                  value={textFor(textLang, 'full')}
                  onChange={e => patchText(textLang, 'full', e.target.value)}
                  placeholder={defaultFullFor(textLang)}
                  disabled={!isAdmin} className="min-h-[72px] text-sm leading-relaxed"
                />
              </div>
            </div>

            {isAdmin && (
              <div className="flex items-center gap-2 pt-1">
                <Button onClick={handleSave} disabled={saving || !canSave} className="gap-2">
                  <Save className="h-4 w-4" />
                  {saving ? t('callScripts.savingDots') : t('promo.save')}
                </Button>
                {dirty && (
                  <Button variant="outline" onClick={() => setDraft(saved)} disabled={saving}>
                    {t('callScripts.discardChanges')}
                  </Button>
                )}
                {draft.enabled && !complete && (
                  <span className="text-[11px] text-destructive">{t('promo.incomplete')}</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Exactly what the agents will read on /calls. */}
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">{t('promo.previewTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl border border-amber-400/60 bg-amber-50/80 px-3 py-2.5 space-y-1.5 dark:border-amber-500/40 dark:bg-amber-500/10">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                <Flame className="h-3 w-3" /> {t('promo.kicker')}
              </span>
              {/* Desktop strip wording (short), then the full sentence agents get
                  on mobile and in the tooltip — both in the language being edited,
                  and both reflecting any custom text already typed. */}
              <p className="text-[13px] leading-snug text-muted-foreground">{previewLine('short')}</p>
              <p className="text-[12px] leading-snug text-muted-foreground/80">{previewLine('full')}</p>
              <p className="text-[11px] leading-snug text-muted-foreground/70">{i18n.getFixedT(textLang)('promo.rule')}</p>
              {draft.note && <p className="text-[11px] leading-snug text-muted-foreground/70">{draft.note}</p>}
              <div>
                <span className="rounded-lg bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                  {t('promo.today', { n: 4, total: formatMoney((draft.bonus_eur ?? 0) * 4) })}
                </span>
              </div>
            </div>
            {!!draft.price_eur && (
              <p className="text-[11px] text-muted-foreground">
                {t('promo.levHint', { price: formatPriceInline(draft.price_eur) })}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground/70">{t('promo.recountHint')}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
