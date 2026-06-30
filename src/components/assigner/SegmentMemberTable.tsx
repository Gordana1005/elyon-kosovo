import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Phone, UserX } from 'lucide-react';
import { formatEur, formatLev } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/EmptyState';
import { MobileCard, MobileCardHeader, MobileCardField } from '@/components/ui/mobile-card';

export interface SegmentMember {
  list_id: string;
  customer_phone: string;
  customer_name: string;
  product_name?: string | null;
  trigger_order_id?: string | null;
  trigger_event_at: string;
  trigger_price: number;
  last_paid_at?: string | null;
  paid_count: number;
  lifetime_value: number;
  avg_package_price?: number | null;   // NEW: first-class after priority migration (lifetime / paid_count)
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  assigned_at?: string | null;
  last_call_at: string | null;
  last_call_outcome: string | null;
  in_call_again_until?: string | null;
  is_completed: boolean;
}

interface Props {
  members: SegmentMember[];
  /** Keys are customer_phone (within one list) — selection is per current list. */
  isSelected: (phone: string) => boolean;
  onToggle: (m: SegmentMember) => void;
  onToggleAll: () => void;
  allOnPageSelected: boolean;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
  /** Compact paddings for the inline (Assigner) variant. */
  compact?: boolean;
  /** Optional: if provided, render a one-click unassign button per row (for the inspector "per-agent" view). */
  onUnassignSingle?: (m: SegmentMember) => void | Promise<void>;
  /** Hide selection checkboxes + row-click selection (read-only view, e.g. the
   *  informational "Trashed" list which is never distributed). Defaults to true. */
  selectable?: boolean;
}

export function SegmentMemberTable({
  members, isSelected, onToggle, onToggleAll, allOnPageSelected,
  page, totalPages, onPageChange, loading, compact, onUnassignSingle,
  selectable = true,
}: Props) {
  const { t } = useTranslation();
  const pad = compact ? 'px-2 py-1.5' : 'px-3 py-2';
  // Only show the Product column when this list actually carries products
  // (e.g. the static "Cancelled Pendings" list). Rule-driven lists leave it null.
  const showProduct = members.some(m => m.product_name);
  const hasUnassign = !!onUnassignSingle;
  const colCount = (showProduct ? 10 : 9) + (hasUnassign ? 1 : 0) - (selectable ? 0 : 1);
  return (
    <div className="space-y-2">
      {/* Desktop: table */}
      <div className="hidden md:block rounded-xl border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
              {selectable && (
                <th className={cn(pad, 'w-8')}>
                  <Checkbox checked={allOnPageSelected} onCheckedChange={onToggleAll} aria-label={t('missedCalls.selectAll')} />
                </th>
              )}
              <th className={cn(pad, 'text-left font-medium')}>{t('ordersPage.colCustomer')}</th>
              <th className={cn(pad, 'text-left font-medium')}>{t('search.phone')}</th>
              {showProduct && <th className={cn(pad, 'text-left font-medium')}>{t('ordersPage.colProduct')}</th>}
              <th className={cn(pad, 'text-right font-medium')}>{t('segTable.lastOrder')}</th>
              <th className={cn(pad, 'text-right font-medium')}>{t('search.totalOrders')}</th>
              <th className={cn(pad, 'text-right font-medium')}>{t('clientProfile.metricAvgPkg')}</th>
              <th className={cn(pad, 'text-right font-medium')}>{t('segTable.totalSpend')}</th>
              <th className={cn(pad, 'text-left font-medium')}>{t('predLists.colAssigned')}</th>
              <th className={cn(pad, 'text-left font-medium')}>{t('segTable.lastCall')}</th>
              {hasUnassign && <th className={cn(pad, 'w-10 text-center font-medium')}>{t('assigner.colAction')}</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colCount} className="text-center text-muted-foreground py-10">{t('common.loading')}</td></tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="p-0">
                  <EmptyState
                    icon={<Phone className="h-5 w-5" />}
                    title={t('segTable.noMembers')}
                    description={t('segTable.adjustFilters')}
                    size="sm"
                    className="border-0 bg-transparent hover:shadow-none py-8"
                  />
                </td>
              </tr>
            ) : members.map(m => {
              const sel = isSelected(m.customer_phone);
              return (
                <tr
                  key={m.customer_phone}
                  className={cn('border-b last:border-0 hover:bg-muted/30', selectable && 'cursor-pointer', sel && 'bg-primary/5')}
                  onClick={selectable ? () => onToggle(m) : undefined}
                >
                  {selectable && (
                    <td className={pad} onClick={e => e.stopPropagation()}>
                      <Checkbox checked={sel} onCheckedChange={() => onToggle(m)} />
                    </td>
                  )}
                  <td className={cn(pad, 'font-medium')}>
                    {m.customer_name || '—'}
                    {m.is_completed && <Badge variant="secondary" className="ml-2 text-[9px]">{t('segTable.done')}</Badge>}
                  </td>
                  <td className={cn(pad, 'font-mono text-xs')}>
                    <a href={`tel:${m.customer_phone}`} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <Phone className="h-3 w-3" />{m.customer_phone}
                    </a>
                  </td>
                  {showProduct && (
                    <td className={cn(pad, 'text-xs max-w-[200px] truncate')} title={m.product_name || ''}>
                      {m.product_name || <span className="text-muted-foreground/40">—</span>}
                    </td>
                  )}
                  <td className={cn(pad, 'text-right text-xs leading-tight')}>
                    <div className="font-mono font-semibold">{formatEur(m.trigger_price)}</div>
                    <div className="text-[10px] text-muted-foreground">{m.trigger_event_at ? format(new Date(m.trigger_event_at), 'dd MMM yy') : ''}</div>
                  </td>
                  <td className={cn(pad, 'text-right tabular-nums text-xs')}>{m.paid_count}</td>
                  <td className={cn(pad, 'text-right text-xs leading-tight')}>
                    {m.avg_package_price != null ? (
                      <>
                        <div className="font-semibold">{formatEur(m.avg_package_price)}</div>
                        <div className="text-[10px] text-muted-foreground">{formatLev(m.avg_package_price)}</div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className={cn(pad, 'text-right text-xs leading-tight')}>
                    <div className="font-semibold">{formatEur(m.lifetime_value)}</div>
                    <div className="text-[10px] text-muted-foreground">{formatLev(m.lifetime_value)}</div>
                  </td>
                  <td className={cn(pad, 'text-xs')}>
                    {m.assigned_agent_name ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                          {m.assigned_agent_name.charAt(0).toUpperCase()}
                        </span>
                        {m.assigned_agent_name}
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={cn(pad, 'text-xs')}>
                    {m.last_call_at ? (
                      <div className="leading-tight">
                        <div>{format(new Date(m.last_call_at), 'dd MMM HH:mm')}</div>
                        {m.last_call_outcome && <div className="text-[10px] text-muted-foreground">{t(`outcome.${m.last_call_outcome}`, { defaultValue: m.last_call_outcome.replace(/_/g, ' ') })}</div>}
                      </div>
                    ) : <span className="text-muted-foreground">{t('segTable.never')}</span>}
                  </td>
                  {hasUnassign && (
                    <td className={cn(pad, 'text-center')} onClick={e => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-rose-600 hover:bg-rose-100 hover:text-rose-700"
                        onClick={() => onUnassignSingle?.(m)}
                        title={t('segTable.unassignTitle')}
                        disabled={!m.assigned_agent_id}
                      >
                        <UserX className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Cards — mobile */}
      <div className="md:hidden space-y-2">
        {loading ? (
          <div className="text-center text-muted-foreground py-10">{t('common.loading')}</div>
        ) : members.length === 0 ? (
          <EmptyState icon={<Phone className="h-5 w-5" />} title={t('segTable.noMembers')} description={t('segTable.adjustFilters')} size="sm" />
        ) : members.map(m => {
          const sel = isSelected(m.customer_phone);
          return (
            <MobileCard key={m.customer_phone} className={cn(sel && 'ring-1 ring-primary')} onClick={selectable ? () => onToggle(m) : undefined}>
              <div className="flex items-start gap-2">
                {selectable && <Checkbox className="mt-1 shrink-0" checked={sel} onCheckedChange={() => onToggle(m)} onClick={e => e.stopPropagation()} />}
                <div className="min-w-0 flex-1">
                  <MobileCardHeader
                    title={<span className="flex items-center gap-1.5">{m.customer_name || '—'}{m.is_completed && <Badge variant="secondary" className="text-[9px]">{t('segTable.done')}</Badge>}</span>}
                    subtitle={<a href={`tel:${m.customer_phone}`} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-primary hover:underline"><Phone className="h-3 w-3" />{m.customer_phone}</a>}
                    badge={m.assigned_agent_name ? <Badge variant="outline" className="text-[10px]">{m.assigned_agent_name}</Badge> : undefined}
                  />
                </div>
              </div>
              {showProduct && <MobileCardField label={t('ordersPage.colProduct')} value={m.product_name || '—'} />}
              <MobileCardField
                label={t('segTable.lastOrder')}
                value={<>{formatEur(m.trigger_price)}{m.trigger_event_at ? <span className="text-muted-foreground font-normal"> · {format(new Date(m.trigger_event_at), 'dd MMM yy')}</span> : null}</>}
              />
              <MobileCardField label={t('segTable.totalOrders')} value={m.paid_count} />
              <MobileCardField
                label={t('segTable.avgPerPkg')}
                value={m.avg_package_price != null
                  ? <>{formatEur(m.avg_package_price)} <span className="text-muted-foreground font-normal">({formatLev(m.avg_package_price)})</span></>
                  : '—'}
              />
              <MobileCardField
                label={t('segTable.totalSpend')}
                value={<>{formatEur(m.lifetime_value)} <span className="text-muted-foreground font-normal">({formatLev(m.lifetime_value)})</span></>}
              />
              <MobileCardField
                label={t('segTable.lastCall')}
                value={m.last_call_at
                  ? `${format(new Date(m.last_call_at), 'dd MMM HH:mm')}${m.last_call_outcome ? ' · ' + t(`outcome.${m.last_call_outcome}`, { defaultValue: m.last_call_outcome.replace(/_/g, ' ') }) : ''}`
                  : t('segTable.never')}
              />
              {hasUnassign && (
                <div className="pt-1">
                  <Button variant="outline" size="sm" className="w-full gap-1.5 text-rose-600" disabled={!m.assigned_agent_id} onClick={(e) => { e.stopPropagation(); onUnassignSingle?.(m); }}>
                    <UserX className="h-3.5 w-3.5" /> Unassign
                  </Button>
                </div>
              )}
            </MobileCard>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{t('segmentDetail.pageOf', { page, totalPages })}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
