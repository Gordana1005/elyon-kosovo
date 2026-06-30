import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Play, Mic, Download, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { apiGetRecordings, apiGetRecordingAudioUrl, type RecordingItem } from '@/lib/api';
import { AppLayout } from '@/layouts/AppLayout';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/EmptyState';

const OUTCOME_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  no_answer: { label: 'No answer', variant: 'secondary' },
  interested: { label: 'Interested', variant: 'default' },
  not_interested: { label: 'Not interested', variant: 'destructive' },
  wrong_number: { label: 'Wrong number', variant: 'outline' },
  call_again: { label: 'Call again', variant: 'secondary' },
  confirmed: { label: 'Confirmed', variant: 'default' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
  trash: { label: 'Trash', variant: 'outline' },
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
// MixMonitor WAV is 8 kHz / 16-bit mono ≈ 16000 bytes/sec.
function estDuration(bytes: number): string {
  const sec = Math.max(0, Math.round((bytes - 44) / 16000));
  const mm = Math.floor(sec / 60).toString().padStart(2, '0');
  const ss = (sec % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function RecordingsPage() {
  const { user } = useAuth();
  const canSeeAll = user?.isAdmin || user?.isManager;

  const [search, setSearch] = useState('');
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);

  const { data, isLoading, error } = useQuery({ queryKey: ['recordings'], queryFn: apiGetRecordings });

  const all: RecordingItem[] = (data?.recordings || []).filter((r) => r.size > 2000); // hide empty/failed (~44 B)
  const q = search.trim().toLowerCase();
  const recordings = q
    ? all.filter((r) => `${r.agent_name || ''} ${r.customer_name || ''} ${r.customer_phone || ''} ${r.dialed || ''} ${r.date || ''}`.toLowerCase().includes(q))
    : all;

  const whenOf = (r: RecordingItem) =>
    r.call_at ? format(new Date(r.call_at), 'dd/MM/yyyy HH:mm:ss') : `${r.date || ''} ${r.time || ''}`.trim() || '—';

  const openPlayer = async (file: string) => {
    if (openFile === file) { setOpenFile(null); setAudioUrl(null); return; }
    setOpenFile(file); setAudioUrl(null); setLoadingAudio(true);
    try { const { url } = await apiGetRecordingAudioUrl(file); setAudioUrl(url); }
    catch { setAudioUrl(null); }
    finally { setLoadingAudio(false); }
  };

  const download = async (file: string) => {
    try {
      const { url } = await apiGetRecordingAudioUrl(file);
      const a = document.createElement('a');
      a.href = url; a.download = file.split('/').pop() || 'recording.wav';
      document.body.appendChild(a); a.click(); a.remove();
    } catch { /* ignore */ }
  };

  return (
    <AppLayout title="Recordings">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Mic className="h-5 w-5 text-primary" /> Call Recordings
          </h1>
          <p className="text-sm text-muted-foreground">
            {recordings.length} recording{recordings.length === 1 ? '' : 's'} · streamed on demand from the PBX
          </p>
        </div>

        {!canSeeAll ? (
          <EmptyState icon={<Mic className="h-5 w-5" />} title="Restricted" description="Only admins and managers can view call recordings." size="sm" />
        ) : (
          <>
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search agent, customer, number, date…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>

            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date &amp; time</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Number</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Length</TableHead>
                    <TableHead className="text-right pr-4">Recording</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : error ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-destructive">Couldn't load recordings (PBX service unreachable).</TableCell></TableRow>
                  ) : recordings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="p-0">
                        <EmptyState icon={<Mic className="h-5 w-5" />} title="No recordings found" description="Recordings appear here for answered outbound calls." size="sm" className="border-0 bg-transparent hover:shadow-none" />
                      </TableCell>
                    </TableRow>
                  ) : recordings.map((r) => {
                    const isOpen = openFile === r.file;
                    return (
                      <Fragment key={r.file}>
                        <TableRow className="group">
                          <TableCell className="text-sm whitespace-nowrap">{whenOf(r)}</TableCell>
                          <TableCell className="text-sm">{r.agent_name || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-sm font-medium">{r.customer_name || <span className="text-muted-foreground font-normal">Unknown</span>}</TableCell>
                          <TableCell className="font-mono text-xs">{r.customer_phone || r.dialed || '—'}</TableCell>
                          <TableCell>
                            {r.outcome ? <Badge variant={OUTCOME_LABELS[r.outcome]?.variant || 'outline'}>{OUTCOME_LABELS[r.outcome]?.label || r.outcome}</Badge> : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell className="font-mono tabular-nums text-sm">{estDuration(r.size)}</TableCell>
                          <TableCell className="text-right pr-4">
                            <div className="inline-flex gap-1.5">
                              <Button variant={isOpen ? 'secondary' : 'outline'} size="sm" onClick={() => openPlayer(r.file)} className="gap-1.5 h-7">
                                <Play className={cn('h-3 w-3', isOpen && 'fill-current')} />
                                {isOpen ? 'Hide' : 'Play'}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => download(r.file)} className="gap-1.5 h-7 text-xs" title="Download">
                                <Download className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={7} className="py-3">
                              {loadingAudio ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading audio…</div>
                              ) : audioUrl ? (
                                <audio controls autoPlay src={audioUrl} className="w-full max-w-2xl h-9" />
                              ) : (
                                <span className="text-sm text-destructive">Couldn't load this recording.</span>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
