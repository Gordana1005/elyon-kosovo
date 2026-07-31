import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Beaker, Package, FlaskConical, Coins, TrendingUp } from 'lucide-react';
import { KpiCard as Kpi } from '@/components/insights/KpiCard';
import { formatMoney } from '@/lib/currency';
import { cn } from '@/lib/utils';
import type { InsightsResponse } from '@/lib/api';

// Dual EUR/ЛВ money (elyon-currency): EUR primary, LEV muted.
function Money({ eur, className }: { eur: number; className?: string }) {
  return (
    <span className={className}>
      {formatMoney(eur)}
    </span>
  );
}

// Commission tier (mirrors packageBonusRate in the edge fn): <25€→1, 25–35→2, ≥35→3.
const tier = (u: number) => (u >= 35 ? 3 : u > 25 ? 2 : 1);

export default function MarginLabTab({ data }: { data: InsightsResponse }) {
  const { t } = useTranslation();
  const ml = data.margin_lab;
  const [target, setTarget] = useState<number>(ml?.target_profit_per_package ?? 7);
  const vat = ml?.vat_rate ?? 0.18;
  const gross = 1 + vat;
  const blendedDeliver = ml?.blended_deliver_cost ?? 3.5;

  // Floor price that nets `tgt` per package: P = (1+vat)·(tgt + cogs + deliver + commission),
  // with the commission tier consistent with the resulting price.
  const floorFor = (cogs: number, deliver: number, tgt: number) => {
    for (const m of [1, 2, 3]) { const P = gross * (tgt + cogs + deliver + m); if (tier(P) === m) return P; }
    return gross * (tgt + cogs + deliver + 3);
  };

  const products = useMemo(() => {
    const rows = ml?.by_product ?? [];
    return rows.map((p) => {
      const floor = floorFor(p.cost_known ? p.cogs_unit : 0, p.avg_delivery_share, target);
      return {
        ...p,
        floor,
        clears: p.net_profit_per_pkg >= target,
        upliftPct: p.avg_realized_price > 0 ? Math.round((floor / p.avg_realized_price - 1) * 100) : null,
      };
    });
  }, [ml, target, gross]);

  // ── Bundle simulator ──
  const [simProduct, setSimProduct] = useState<string>('');
  const [simPaid, setSimPaid] = useState<number>(4);
  const [simBonus, setSimBonus] = useState<number>(0);
  const [simPrice, setSimPrice] = useState<number>(56);
  const selected = (ml?.by_product ?? []).find((p) => p.product === simProduct) ?? (ml?.by_product ?? [])[0];

  const sim = useMemo(() => {
    if (!selected) return null;
    const cogsUnit = selected.cost_known ? selected.cogs_unit : 0;
    const shipped = Math.max(1, (Number(simPaid) || 0) + (Number(simBonus) || 0));
    const price = Math.max(0, Number(simPrice) || 0);
    const effPkg = price / shipped;
    const vatAmt = price - price / gross;
    const cogs = shipped * cogsUnit;
    const delivery = blendedDeliver;
    const commission = shipped * tier(effPkg);
    const net = price - vatAmt - cogs - delivery - commission;
    const perPkg = net / shipped;
    // Price needed so every shipped package nets `target` (commission held at current tier).
    const needed = gross * (target * shipped + cogs + delivery + commission);
    return { cogsUnit, shipped, price, effPkg, vatAmt, cogs, delivery, commission, net, perPkg, pass: perPkg >= target, needed, neededPer: needed / shipped, costKnown: selected.cost_known };
  }, [selected, simPaid, simBonus, simPrice, target, gross, blendedDeliver]);

  if (!ml || (ml.by_product?.length ?? 0) === 0) {
    return <div className="text-sm text-muted-foreground py-12 text-center">{t('insights.mlNoData')}</div>;
  }

  const r = ml.realized;
  const netTone = (v: number) => (v >= target ? 'text-emerald-600' : v >= 0 ? 'text-amber-600' : 'text-rose-600');

  return (
    <div className="space-y-4">
      {/* Target control + intro */}
      <Card>
        <CardContent className="pt-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <div className="text-sm text-muted-foreground max-w-xl">{t('insights.mlIntro')}</div>
          <label className="flex items-center gap-2 shrink-0 text-sm font-medium">
            {t('insights.mlTargetLabel')}
            <span className="text-muted-foreground">€</span>
            <Input
              type="number" min={0} step={0.5} value={target}
              onChange={(e) => setTarget(Math.max(0, Number(e.target.value) || 0))}
              className="h-9 w-20 text-right tabular-nums"
            />
          </label>
        </CardContent>
      </Card>

      {/* Realized price KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi icon={Coins} label={t('insights.mlAvg')} value={formatMoney(r.avg)} sub={`${r.packages.toLocaleString()} ${t('insights.colPackages').toLowerCase()}`} tone="bg-sky-100 text-sky-700" />
        <Kpi icon={FlaskConical} label={t('insights.mlMedian')} value={formatMoney(r.median)} sub={`${formatMoney(r.p25)} – ${formatMoney(r.p75)}`} />
        <Kpi icon={Package} label={t('insights.mlMin')} value={formatMoney(r.min)} tone="bg-rose-100 text-rose-700" />
        <Kpi icon={Package} label={t('insights.mlMax')} value={formatMoney(r.max)} tone="bg-emerald-100 text-emerald-700" />
        <Kpi icon={TrendingUp} label={t('insights.mlNetPerPkg')} value={formatMoney(r.net_profit_per_pkg)} sub={t('insights.mlTargetIs', { v: formatMoney(target) })} tone={r.net_profit_per_pkg >= target ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'} />
      </div>

      {/* Per-product floor table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><FlaskConical className="h-4 w-4" /> {t('insights.mlProductsTitle')}</CardTitle>
          <div className="text-xs text-muted-foreground">{t('insights.mlFloorHelp')}</div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left py-2">{t('insights.mlColProduct')}</th>
                <th className="text-right py-2">{t('insights.mlColPkgs')}</th>
                <th className="text-right py-2">{t('insights.mlColRealized')}</th>
                <th className="text-right py-2">{t('insights.mlColCogs')}</th>
                <th className="text-right py-2">{t('insights.mlColNetNow')}</th>
                <th className="text-right py-2">{t('insights.mlColFloor')}</th>
                <th className="text-right py-2">{t('insights.mlColUplift')}</th>
                <th className="text-right py-2">{t('insights.mlColStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.product} className="border-b last:border-0">
                  <td className="py-2 font-medium">
                    {p.product}
                    {!p.cost_known && <span className="ml-1 text-[10px] text-amber-600">({t('insights.mlNoCost')})</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums">{p.packages.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(p.avg_realized_price)}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">{p.cost_known ? formatMoney(p.cogs_unit) : '—'}</td>
                  <td className={cn('py-2 text-right tabular-nums font-medium', netTone(p.net_profit_per_pkg))}>{formatMoney(p.net_profit_per_pkg)}</td>
                  <td className="py-2 text-right tabular-nums font-semibold">{formatMoney(p.floor)}</td>
                  <td className={cn('py-2 text-right tabular-nums', (p.upliftPct ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-600')}>
                    {p.upliftPct == null ? '—' : `${p.upliftPct > 0 ? '+' : ''}${p.upliftPct}%`}
                  </td>
                  <td className="py-2 text-right">
                    <Badge variant="outline" className={p.clears ? 'border-emerald-300 text-emerald-700 bg-emerald-50' : 'border-rose-300 text-rose-700 bg-rose-50'}>
                      {p.clears ? t('insights.mlClears') : t('insights.mlBelow')}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Bundle simulator */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Beaker className="h-4 w-4" /> {t('insights.mlSimTitle')}</CardTitle>
          <div className="text-xs text-muted-foreground">{t('insights.mlSimHelp')}</div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('insights.mlSimProduct')}</span>
              <Select value={selected?.product ?? ''} onValueChange={setSimProduct}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(ml.by_product ?? []).map((p) => <SelectItem key={p.product} value={p.product}>{p.product}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('insights.mlSimPackages')}</span>
              <Input type="number" min={1} value={simPaid} onChange={(e) => setSimPaid(Number(e.target.value))} className="h-9 tabular-nums" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('insights.mlSimBonus')}</span>
              <Input type="number" min={0} value={simBonus} onChange={(e) => setSimBonus(Number(e.target.value))} className="h-9 tabular-nums" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('insights.mlSimPrice')}</span>
              <Input type="number" min={0} step={1} value={simPrice} onChange={(e) => setSimPrice(Number(e.target.value))} className="h-9 tabular-nums" />
            </label>
          </div>

          {sim && (
            <div className={cn('rounded-lg border p-4', sim.pass ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50')}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-lg font-bold">
                  {sim.pass ? t('insights.mlSimPass') : t('insights.mlSimFail')}
                </div>
                <div className="text-sm">
                  {t('insights.mlSimShipped')}: <span className="font-semibold">{sim.shipped}</span> ·{' '}
                  {t('insights.mlSimEffPrice')}: <span className="font-semibold">{formatMoney(sim.effPkg)}</span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm">
                <Row label={t('insights.mlSimPrice')} eur={sim.price} />
                <Row label={`− ${t('insights.kpiVat', { pct: Math.round(vat * 100) })}`} eur={-sim.vatAmt} />
                <Row label={`− ${t('insights.mlColCogs')}`} eur={-sim.cogs} muted={!sim.costKnown} />
                <Row label={`− ${t('insights.mlSimDelivery')}`} eur={-sim.delivery} />
                <Row label={`− ${t('insights.mlSimCommission')}`} eur={-sim.commission} />
                <div className="flex justify-between font-bold border-t pt-1 col-span-2 sm:col-span-3">
                  <span>{t('insights.mlSimNetOrder')}</span>
                  <Money eur={sim.net} className={sim.net >= 0 ? 'text-emerald-700' : 'text-rose-700'} />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span>{t('insights.mlSimNetPkg')}: <span className={cn('font-bold', netTone(sim.perPkg))}>{formatMoney(sim.perPkg)}</span></span>
                {!sim.pass && (
                  <span className="text-rose-700">{t('insights.mlSimNeedPrice', { target: formatMoney(target), price: formatMoney(sim.needed), per: formatMoney(sim.neededPer) })}</span>
                )}
              </div>
              {!sim.costKnown && <div className="mt-2 text-xs text-amber-700">{t('insights.mlCostUnknownWarn')}</div>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, eur, muted }: { label: string; eur: number; muted?: boolean }) {
  return (
    <div className={cn('flex justify-between', muted && 'text-muted-foreground')}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatMoney(eur)}</span>
    </div>
  );
}
