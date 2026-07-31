// Export the Pure Profit tab over the selected date range as Excel (default,
// one sheet per section) or CSV (one file, SECTION header rows, ';' + BOM for
// BG Excel). Sections are toggleable. Numbers in Excel are real numbers so
// they can be summed/filtered/formatted. Money is EUR; the Summary section
// also carries BGN at the fixed 1.95583 peg.
// The xlsx library (~430 kB) is loaded on demand, only when exporting Excel.
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from '@/components/ui/dialog';
import { toCsv, downloadCsv, type CsvColumn } from '@/lib/csv';
import { eurToLev } from '@/lib/currency';
import { cn } from '@/lib/utils';
import type { InsightsResponse } from '@/lib/api';
import type { DateRange } from '@/components/DateRangePicker';

const n2 = (v: number | undefined | null) => Math.round((Number(v) || 0) * 100) / 100;

type SectionKey = 'summary' | 'products' | 'logistics' | 'commissions';
type Section = { name: string; rows: Record<string, unknown>[]; widths: number[] };

const SECTIONS: { key: SectionKey; label: string; hint: string }[] = [
  { key: 'summary', label: 'Summary', hint: 'Cash, VAT, COGS, shipping, commissions, clear profit' },
  { key: 'products', label: 'Product breakdown', hint: 'Per-product packages, revenue, cost, profit' },
  { key: 'logistics', label: 'Shipping costs by courier', hint: 'Delivered/returned counts and spend' },
  { key: 'commissions', label: 'Agent commissions', hint: 'Per-agent payouts and packages sold' },
];

export default function PureProfitExportDialog({ data, range }: { data: InsightsResponse; range: DateRange }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [picked, setPicked] = useState<Record<SectionKey, boolean>>({
    summary: true, products: true, logistics: true, commissions: true,
  });

  const toggle = (k: SectionKey, v: boolean) => setPicked(p => ({ ...p, [k]: v }));
  const anyPicked = SECTIONS.some(s => picked[s.key]);

  // One source of truth for both formats: each picked section becomes
  // uniform row objects (column header → value).
  const buildSections = (): Section[] => {
    const pp = data.pure_profit;
    const out: Section[] = [];

    if (picked.summary && pp) {
      const vatPct = Math.round((pp.vat_rate ?? 0.2) * 100);
      const money = (metric: string, eur: number) => ({
        'Metric': metric, 'EUR': n2(eur), 'BGN': n2(eurToLev(eur)),
      });
      // Unchecked topics disappear from the Summary too (e.g. a report shared
      // without commission info must not carry the commissions line). Clear
      // profit is then relabeled and adjusted so the visible rows still sum
      // exactly — never show a total whose hidden parts can be derived.
      const commissions = pp.agent_commissions ?? pp.special_agent_commissions ?? 0;
      const shipping = (pp.delivery_cost ?? 0) + (pp.return_loss ?? 0);
      const rows = [
        money('Cash collected (paid orders)', pp.cash_collected ?? 0),
        money(`VAT (${vatPct}% included in price)`, -(pp.vat ?? 0)),
        money('Product cost (COGS)', -(pp.cogs ?? 0)),
      ];
      if (picked.logistics) {
        rows.push(money('Delivery cost', -(pp.delivery_cost ?? 0)));
        rows.push(money('Return loss (round-trip)', -(pp.return_loss ?? 0)));
      }
      if (picked.commissions) rows.push(money('Agent commissions', -commissions));
      const excluded = [
        ...(picked.logistics ? [] : ['shipping']),
        ...(picked.commissions ? [] : ['agent commissions']),
      ];
      const clear = (pp.clear_profit ?? 0)
        + (picked.logistics ? 0 : shipping)
        + (picked.commissions ? 0 : commissions);
      rows.push(money(excluded.length ? `Clear profit (excl. ${excluded.join(' & ')})` : 'Clear profit', clear));
      rows.push(
        { 'Metric': 'Paid orders', 'EUR': pp.paid_orders ?? 0, 'BGN': '' },
        { 'Metric': 'Paid packages', 'EUR': pp.paid_packages ?? 0, 'BGN': '' },
        { 'Metric': 'Cost coverage %', 'EUR': n2((pp.cost_coverage ?? 1) * 100), 'BGN': '' },
      );
      out.push({ name: 'Summary', widths: [40, 14, 14], rows });
    }

    if (picked.products && pp?.by_product?.length) {
      out.push({
        name: 'Products',
        widths: [36, 10, 8, 14, 13, 13, 16, 11, 12, 15],
        rows: pp.by_product.map(p => ({
          'Product': p.product,
          'Packages': p.packages,
          'Orders': p.orders,
          'Unit Price (EUR)': n2(p.unit_price),
          'Unit Cost (EUR)': p.unit_cost > 0 ? n2(p.unit_cost) : '',
          'Revenue (EUR)': n2(p.revenue),
          'Net Revenue (EUR)': n2(p.net_revenue ?? p.revenue),
          'Cost (EUR)': n2(p.cogs),
          'Profit (EUR)': n2(p.profit),
          'Net Profit (EUR)': n2(p.net_profit ?? p.profit),
        })),
      });
    }

    if (picked.logistics && data.logistics?.length) {
      out.push({
        name: 'Shipping by Courier',
        widths: [12, 10, 10, 10, 18, 16, 12],
        rows: data.logistics.map(l => ({
          'Courier': l.courier,
          'Service': l.service,
          'Delivered': l.delivered,
          'Returned': l.returned,
          'Delivery Cost (EUR)': n2(l.deliver_cost),
          'Return Loss (EUR)': n2(l.return_cost),
          'Total (EUR)': n2(l.total_cost),
        })),
      });
    }

    if (picked.commissions) {
      const agents = (data.agents || [])
        .filter((a: any) => (a.payout_earned ?? 0) > 0)
        .sort((a: any, b: any) => (b.payout_earned ?? 0) - (a.payout_earned ?? 0));
      if (agents.length) {
        out.push({
          name: 'Agent Commissions',
          widths: [24, 13, 14],
          rows: agents.map((a: any) => ({
            'Agent': a.name,
            'Payout (EUR)': n2(a.payout_earned),
            'Packages Sold': a.packages_sold ?? a.units ?? 0,
          })),
        });
      }
    }

    return out;
  };

  const doExport = async () => {
    setBusy(true);
    try {
      const sections = buildSections();
      if (!sections.length) return;
      const stamp = range.from || range.to
        ? `${range.from || 'start'}_to_${range.to || 'today'}`
        : 'all-time';

      if (format === 'xlsx') {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        for (const s of sections) {
          const ws = XLSX.utils.json_to_sheet(s.rows);
          ws['!cols'] = s.widths.map(wch => ({ wch }));
          XLSX.utils.book_append_sheet(wb, ws, s.name);
        }
        XLSX.writeFile(wb, `pure-profit_${stamp}.xlsx`);
      } else {
        const blocks = sections.map((s, i) => {
          const cols: CsvColumn<Record<string, unknown>>[] =
            Object.keys(s.rows[0]).map(k => ({ key: k, header: k }));
          // BOM only on the first block so Excel sees exactly one.
          return `SECTION;${s.name}\r\n${toCsv(s.rows, cols, ';', i === 0)}`;
        });
        downloadCsv(`pure-profit_${stamp}.csv`, blocks.join('\r\n\r\n'));
      }
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="h-4 w-4" /> Export
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('ppExport.title')}</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground -mt-2">
          Period: {range.from || range.to ? `${range.from || '…'} → ${range.to || 'today'}` : 'all time'}
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={() => setFormat('xlsx')}
            className={cn(
              'flex items-center gap-2 rounded-md border p-2.5 text-sm transition-colors',
              format === 'xlsx' ? 'border-primary bg-primary/5 font-medium' : 'text-muted-foreground hover:bg-muted/50',
            )}
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            <span>Excel (.xlsx)<span className="block text-[11px] font-normal text-muted-foreground">{t('ppExport.sheetPerSection')}</span></span>
          </button>
          <button
            type="button"
            onClick={() => setFormat('csv')}
            className={cn(
              'flex items-center gap-2 rounded-md border p-2.5 text-sm transition-colors',
              format === 'csv' ? 'border-primary bg-primary/5 font-medium' : 'text-muted-foreground hover:bg-muted/50',
            )}
          >
            <FileText className="h-4 w-4 text-sky-600" />
            <span>CSV<span className="block text-[11px] font-normal text-muted-foreground">{t('ppExport.forImports')}</span></span>
          </button>
        </div>
        <div className="space-y-3 py-2">
          {SECTIONS.map(s => (
            <div key={s.key} className="flex items-start gap-3">
              <Checkbox
                id={`exp-${s.key}`}
                checked={picked[s.key]}
                onCheckedChange={(v) => toggle(s.key, v === true)}
                className="mt-0.5"
              />
              <Label htmlFor={`exp-${s.key}`} className="font-normal cursor-pointer">
                <span className="font-medium">{s.label}</span>
                <span className="block text-xs text-muted-foreground">{s.hint}</span>
              </Label>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={doExport} disabled={!anyPicked || busy} className="gap-2">
            <Download className="h-4 w-4" /> {busy ? t('ppExport.exporting') : t('ppExport.exportBtn', { fmt: format === 'xlsx' ? 'Excel' : 'CSV' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
