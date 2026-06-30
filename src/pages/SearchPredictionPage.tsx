import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/layouts/AppLayout';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Phone, FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { apiSearchPrediction, type SearchPredictionResult } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/EmptyState';
import { STATUS_TONE } from '@/lib/searchFormat';
import { CustomerSummaryCard, OrdersResultTable } from '@/components/search/searchShared';

export default function SearchPredictionPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchPredictionResult | null>(null);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    try {
      const data = await apiSearchPrediction(q);
      setResults(data);
      if (!data.orders.length && !data.leads.length) {
        toast.info(t('search.noMatches'));
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <AppLayout title={t('nav.searchPrediction')}>
      <div className="space-y-6">
        {/* Search Bar */}
        <div className="flex gap-2 max-w-xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('search.placeholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-10"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Phone search normalizes numbers — formats like 078319044, +38978319044, 38978319044 all match the same record.
        </p>

        {results && (
          <CustomerSummaryCard orders={results.orders} />
        )}

        {results && (
          <div className="space-y-6">
            <OrdersResultTable orders={results.orders} orderHistory={results.order_history} />

            {/* Prediction Leads */}
            {results.leads.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileSpreadsheet className="h-5 w-5" /> Prediction Leads ({results.leads.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {results.leads.map((lead) => (
                    <div key={lead.id} className="border rounded-lg p-4 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{lead.name || '—'}</span>
                          <Badge className={cn('text-[10px]', STATUS_TONE[lead.status] || 'bg-muted text-muted-foreground')}>
                            {t(`leadStatus.${lead.status}`, { defaultValue: lead.status })}
                          </Badge>
                          {!lead.is_owned && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{t('search.viewOnly')}</span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(lead.created_at), 'dd/MM/yyyy HH:mm')}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                        <div><Phone className="inline h-3 w-3 mr-1" />{lead.telephone}</div>
                        <div>Product: {lead.product || '—'}</div>
                        <div>Agent: {lead.assigned_agent_name || 'Unassigned'}</div>
                        <div>List: {lead.prediction_lists?.name || '—'}</div>
                      </div>
                      {lead.notes && (
                        <div className="text-xs text-muted-foreground">Notes: {lead.notes}</div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {results.orders.length === 0 && results.leads.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <EmptyState
                  icon={<Search className="h-4 w-4" />}
                  title={`No results found for "${query}"`}
                  size="sm"
                  className="border-0 bg-transparent py-1 text-xs"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
