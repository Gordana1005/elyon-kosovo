import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Phone, PhoneCall, Loader2 } from 'lucide-react';
import { apiSearchPrediction } from '@/lib/api';
import { EmptyState } from '@/components/EmptyState';
import { CustomerSummaryCard, OrdersResultTable } from './searchShared';

interface Props {
  phone: string | null;
  seedName?: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Customer detail popped from the topbar search. Re-fetches by phone so it shows
 * the customer's FULL order history (not just the rows that matched the query),
 * and offers a one-click jump to the Calls page to dial them.
 */
export function CustomerSearchModal({ phone, seedName, open, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['customer-search-modal', phone],
    queryFn: () => apiSearchPrediction(phone!),
    enabled: open && !!phone,
    staleTime: 15_000,
  });

  const orders = data?.orders ?? [];

  const callCustomer = () => {
    if (!phone) return;
    navigate(`/calls?phone=${encodeURIComponent(phone)}`);
    onClose();
  };

  const callBtn = (
    <Button size="sm" onClick={callCustomer} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
      <PhoneCall className="h-3.5 w-3.5" /> {t('search.openInCallsAndCall')}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <Phone className="h-4 w-4 shrink-0" />
            <span className="truncate">{seedName || t('search.customer')}</span>
            {phone && <span className="font-mono text-sm font-normal text-muted-foreground">{phone}</span>}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> {t('common.loading')}
          </div>
        ) : orders.length > 0 ? (
          <div className="space-y-4">
            <CustomerSummaryCard orders={orders} action={callBtn} />
            <OrdersResultTable orders={orders} orderHistory={data?.order_history ?? []} />
          </div>
        ) : (
          <div className="rounded-lg border p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium truncate">{seedName || '—'}</div>
              <div className="font-mono text-sm text-muted-foreground">{phone}</div>
              <EmptyState
                icon={<Phone className="h-3 w-3" />}
                title={t('search.noOrdersForNumber')}
                size="sm"
                className="border-0 bg-transparent py-0 text-[10px]"
              />
            </div>
            {callBtn}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
