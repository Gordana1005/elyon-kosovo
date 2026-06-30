import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, Loader2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiGetVoipAgents, apiSetAgentCallerId } from '@/lib/api';

export function TelephonyTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['voip-agents'], queryFn: apiGetVoipAgents });
  const [saving, setSaving] = useState<string | null>(null);

  const agents = data?.agents || [];
  const dids = data?.dids || [];

  const setCid = async (userId: string, cid: string) => {
    setSaving(userId);
    try {
      await apiSetAgentCallerId(userId, cid);
      toast({ title: t('telephony.callerIdUpdated'), description: t('telephony.applies2min') });
      qc.invalidateQueries({ queryKey: ['voip-agents'] });
    } catch (e: any) {
      toast({ title: t('telephony.failedUpdate'), description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Phone className="h-4 w-4 text-primary" /> Agent caller IDs
        </h2>
        <p className="text-sm text-muted-foreground">
          Every agent calls out from <span className="font-mono">02 423 4100</span> by default. Change an agent's
          outbound number here — it applies on the PBX within ~2 minutes. Only the company's own numbers can be selected.
        </p>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('search.colAgent')}</TableHead>
              <TableHead>{t('telephony.extension')}</TableHead>
              <TableHead>{t('telephony.outboundCallerId')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">{t('common.loading')}</TableCell></TableRow>
            ) : error ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8 text-destructive">{t('telephony.loadFailed')}</TableCell></TableRow>
            ) : agents.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">{t('telephony.noLines')}</TableCell></TableRow>
            ) : agents.map((a) => (
              <TableRow key={a.user_id}>
                <TableCell className="font-medium">
                  {a.full_name}
                  {a.email && <div className="text-xs text-muted-foreground">{a.email}</div>}
                </TableCell>
                <TableCell className="font-mono text-sm">{a.extension}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Select value={a.primary_caller_id} onValueChange={(v) => setCid(a.user_id, v)} disabled={saving === a.user_id}>
                      <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {dids.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {saving === a.user_id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
