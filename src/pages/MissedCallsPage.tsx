import { PhoneIncoming } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/layouts/AppLayout';
import { MissedCallsPanel } from '@/components/calls/MissedCallsPanel';

export default function MissedCallsPage() {
  const { t } = useTranslation();
  return (
    <AppLayout title={t('nav.missedCalls')}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <PhoneIncoming className="h-5 w-5 text-primary" />
          {t('nav.missedCalls')}
        </h1>
        <MissedCallsPanel />
      </div>
    </AppLayout>
  );
}
