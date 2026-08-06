import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/layouts/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Globe, History, Radio, Tag } from 'lucide-react';
import { AccountsTab } from '@/components/altercpa/AccountsTab';
import { MirrorTab } from '@/components/altercpa/MirrorTab';
import { OfferQueueTab } from '@/components/altercpa/OfferQueueTab';
import { SyncRunsTab } from '@/components/altercpa/SyncRunsTab';

/**
 * AlterCPA Bridge — a read-only mirror of an AlterCPA account.
 *
 * Leads keep arriving at AlterCPA exactly as before; this pulls them in so the
 * CRM is one place. Leads in a callable geo become normal pending orders and go
 * through the usual pipeline; every other geo is mirrored for reporting and
 * never enters a calling queue. Nothing is ever sent back to AlterCPA.
 *
 * View is admin/manager; every mutation is re-checked admin-only server-side.
 */
export default function AlterCpaPage() {
  const { t } = useTranslation();

  return (
    <AppLayout title={t('nav.altercpa')}>
      <Tabs defaultValue="mirror" className="space-y-6">
        <TabsList>
          <TabsTrigger value="mirror" className="gap-2">
            <Globe className="h-4 w-4" /> {t('altercpa.tabMirror')}
          </TabsTrigger>
          <TabsTrigger value="offers" className="gap-2">
            <Tag className="h-4 w-4" /> {t('altercpa.tabOffers')}
          </TabsTrigger>
          <TabsTrigger value="accounts" className="gap-2">
            <Radio className="h-4 w-4" /> {t('altercpa.tabAccounts')}
          </TabsTrigger>
          <TabsTrigger value="runs" className="gap-2">
            <History className="h-4 w-4" /> {t('altercpa.tabRuns')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mirror"><MirrorTab /></TabsContent>
        <TabsContent value="offers"><OfferQueueTab /></TabsContent>
        <TabsContent value="accounts"><AccountsTab /></TabsContent>
        <TabsContent value="runs"><SyncRunsTab /></TabsContent>
      </Tabs>
    </AppLayout>
  );
}
