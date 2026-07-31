import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/layouts/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Handshake, Tag, Send } from 'lucide-react';
import { AffiliatesTab } from '@/components/affiliates/AffiliatesTab';
import { OffersTab } from '@/components/affiliates/OffersTab';
import { PostbackLogTab } from '@/components/affiliates/PostbackLogTab';

/**
 * Affiliates (Admin) — manage webmasters, their offers/payouts, and the
 * postback delivery log. View is admin/manager; every mutation is re-checked
 * admin-only server-side (managers see a read-only program overview without
 * API keys). The affiliate-facing portal is a separate page set (/affiliate).
 */
export default function AffiliatesAdminPage() {
  const { t } = useTranslation();

  return (
    <AppLayout title={t('nav.affiliates')}>
      <Tabs defaultValue="affiliates" className="space-y-6">
        <TabsList>
          <TabsTrigger value="affiliates" className="gap-2">
            <Handshake className="h-4 w-4" /> {t('affiliatesAdmin.tabAffiliates')}
          </TabsTrigger>
          <TabsTrigger value="offers" className="gap-2">
            <Tag className="h-4 w-4" /> {t('affiliatesAdmin.tabOffers')}
          </TabsTrigger>
          <TabsTrigger value="postbacks" className="gap-2">
            <Send className="h-4 w-4" /> {t('affiliatesAdmin.tabPostbacks')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="affiliates"><AffiliatesTab /></TabsContent>
        <TabsContent value="offers"><OffersTab /></TabsContent>
        <TabsContent value="postbacks"><PostbackLogTab /></TabsContent>
      </Tabs>
    </AppLayout>
  );
}
