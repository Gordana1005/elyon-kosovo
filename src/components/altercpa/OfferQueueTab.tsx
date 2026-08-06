import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  apiGetAlterCpaOfferMap, apiUpdateAlterCpaOfferMap, apiGetProducts, AlterCpaOfferMapRow,
} from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { apiErrorText } from '@/i18n/apiErrors';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/EmptyState';
import { formatMoney } from '@/lib/currency';
import { CheckCircle2, EyeOff, Info, Loader2, Search, Tag } from 'lucide-react';

/**
 * The offer → product queue.
 *
 * A network runs many offers and adds new ones without telling anyone. An offer
 * name we do not recognise must never become an order with product_id = NULL:
 * that order is invisible to every product report and to stock, and nothing
 * would ever surface the gap. So the lead is still mirrored, the sighting is
 * recorded here, and promotion to a real order waits for a human to say which
 * product it is. This tab is that decision queue.
 */
export function OfferQueueTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const queryClient = useQueryClient();

  const [onlyUnmapped, setOnlyUnmapped] = useState(true);
  const [q, setQ] = useState('');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['altercpa-offer-map', onlyUnmapped],
    queryFn: () => apiGetAlterCpaOfferMap({ unmapped: onlyUnmapped }),
  });
  const { data: products = [] } = useQuery<any[]>({ queryKey: ['products'], queryFn: apiGetProducts });

  const onError = (err: any) =>
    toast({ title: t('common.error'), description: apiErrorText(err), variant: 'destructive' });

  const mutation = useMutation({
    mutationFn: (v: { id: string; body: Parameters<typeof apiUpdateAlterCpaOfferMap>[1] }) =>
      apiUpdateAlterCpaOfferMap(v.id, v.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['altercpa-offer-map'] });
      queryClient.invalidateQueries({ queryKey: ['altercpa-leads'] });
      toast({ title: t('common.saved') });
    },
    onError,
  });

  const filtered = q.trim()
    ? rows.filter((r) => r.offer_name.toLowerCase().includes(q.trim().toLowerCase()))
    : rows;
  const unmappedCount = rows.filter((r) => !r.product_id && !r.is_ignored).length;

  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-sm">{t('altercpa.queueHint')}</AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={onlyUnmapped ? 'unmapped' : 'all'} onValueChange={(v) => setOnlyUnmapped(v === 'unmapped')}>
          <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="unmapped">{t('altercpa.queueOnlyUnmapped', { n: unmappedCount })}</SelectItem>
            <SelectItem value="all">{t('altercpa.queueAllOffers')}</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder={t('altercpa.queueSearch')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {!filtered.length ? (
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8" />}
          title={onlyUnmapped ? t('altercpa.queueAllClear') : t('altercpa.queueEmpty')}
          description={onlyUnmapped ? t('altercpa.queueAllClearHint') : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('altercpa.colGeo')}</TableHead>
                <TableHead>{t('altercpa.queueOfferName')}</TableHead>
                <TableHead className="text-right">{t('altercpa.queueVolume')}</TableHead>
                <TableHead className="min-w-[260px]">{t('altercpa.queueProduct')}</TableHead>
                {isAdmin && <TableHead className="w-[100px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <OfferRow
                  key={r.id} row={r} products={products} isAdmin={isAdmin}
                  busy={mutation.isPending}
                  onMap={(productId) => mutation.mutate({ id: r.id, body: { product_id: productId } })}
                  onIgnore={() => mutation.mutate({ id: r.id, body: { is_ignored: !r.is_ignored } })}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function OfferRow({ row, products, isAdmin, busy, onMap, onIgnore }: {
  row: AlterCpaOfferMapRow;
  products: any[];
  isAdmin: boolean;
  busy: boolean;
  onMap: (productId: string | null) => void;
  onIgnore: () => void;
}) {
  const { t } = useTranslation();

  return (
    <TableRow className={row.is_ignored ? 'opacity-50' : undefined}>
      <TableCell><Badge variant="outline">{row.geo}</Badge></TableCell>
      <TableCell className="max-w-[280px]">
        <div className="truncate text-sm" title={row.offer_name}>{row.offer_name}</div>
        {row.is_ignored && (
          <Badge variant="outline" className="mt-1 gap-1 text-xs">
            <EyeOff className="h-3 w-3" /> {t('altercpa.queueIgnored')}
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">{row.seen_count.toLocaleString()}</TableCell>
      <TableCell>
        {isAdmin ? (
          <Select
            value={row.product_id || 'none'}
            disabled={busy}
            onValueChange={(v) => onMap(v === 'none' ? null : v)}
          >
            <SelectTrigger><SelectValue placeholder={t('altercpa.queuePickProduct')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('altercpa.queueUnmapped')}</SelectItem>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} — {formatMoney(p.price)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : row.products ? (
          <span className="text-sm">{row.products.name}</span>
        ) : (
          <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-500/10 text-amber-600">
            <Tag className="h-3 w-3" /> {t('altercpa.queueUnmapped')}
          </Badge>
        )}
      </TableCell>
      {isAdmin && (
        <TableCell>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onIgnore}>
            {row.is_ignored ? t('altercpa.queueUnignore') : t('altercpa.queueIgnore')}
          </Button>
        </TableCell>
      )}
    </TableRow>
  );
}
