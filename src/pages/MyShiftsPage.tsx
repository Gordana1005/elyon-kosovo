import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/i18n/dates';
import { apiGetMyShifts } from '@/lib/api';
import { AppLayout } from '@/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, CalendarIcon, LogIn, Coffee } from 'lucide-react';
import { format, isToday, isFuture, isPast } from 'date-fns';
import { EmptyState } from '@/components/EmptyState';

interface ShiftBreak {
  id: string; break_start: string; break_end: string | null;
}

interface Shift {
  id: string; name: string; date: string; start_time: string; end_time: string;
  clock_in_time?: string | null;
  breaks?: ShiftBreak[];
  total_break_seconds?: number;
}

function fmtBreak(seconds: number): string {
  if (seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function MyShiftsPage() {
  const { t } = useTranslation();
  const { data: shifts = [], isLoading } = useQuery<Shift[]>({
    queryKey: ['my-shifts'],
    queryFn: apiGetMyShifts,
  });

  const todayShifts = shifts.filter(s => isToday(new Date(s.date)));
  const upcomingShifts = shifts.filter(s => isFuture(new Date(s.date)));
  const pastShifts = shifts.filter(s => isPast(new Date(s.date)) && !isToday(new Date(s.date)));

  const ShiftCard = ({ shift, highlight }: { shift: Shift; highlight?: boolean }) => {
    const breakSeconds = shift.total_break_seconds || 0;
    const breakCount = shift.breaks?.length || 0;
    const onBreakNow = (shift.breaks || []).some(b => !b.break_end);
    return (
      <Card className={highlight ? 'border-primary/30 bg-primary/5' : ''}>
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="font-medium text-foreground">{shift.name}</p>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
              <span className="inline-flex items-center gap-1"><CalendarIcon className="h-3 w-3" />{formatDate(new Date(shift.date), 'EEE, MMM d, yyyy')}</span>
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{shift.start_time.substring(0, 5)} - {shift.end_time.substring(0, 5)}</span>
              {shift.clock_in_time && (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <LogIn className="h-3 w-3" />
                  {t('myShifts.clockedIn', { time: format(new Date(shift.clock_in_time), 'HH:mm') })}
                </span>
              )}
              {breakCount > 0 && (
                <span className={`inline-flex items-center gap-1 ${onBreakNow ? 'text-amber-700 font-medium' : 'text-muted-foreground'}`}>
                  <Coffee className="h-3 w-3" />
                  {onBreakNow ? t('myShifts.onBreakNow') : ''}{fmtBreak(breakSeconds)} {t('myShifts.breakSuffix')}{breakCount > 1 ? ` (${breakCount}×)` : ''}
                </span>
              )}
            </div>
          </div>
          {isToday(new Date(shift.date)) && <Badge className="bg-primary text-primary-foreground">{t('myShifts.today')}</Badge>}
        </CardContent>
      </Card>
    );
  };

  return (
    <AppLayout title={t('nav.myShifts')}>
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold text-foreground">{t('nav.myShifts')}</h1>

        {isLoading ? (
          <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
        ) : shifts.length === 0 ? (
          <EmptyState
            icon={<Clock className="h-5 w-5" />}
            title={t('myShifts.noShifts')}
            description={t('myShifts.noShiftsDesc')}
            size="md"
          />
        ) : (
          <>
            {todayShifts.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t('myShifts.today')}</h2>
                <div className="space-y-2">{todayShifts.map(s => <ShiftCard key={s.id} shift={s} highlight />)}</div>
              </div>
            )}
            {upcomingShifts.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t('myShifts.upcoming')}</h2>
                <div className="space-y-2">{upcomingShifts.map(s => <ShiftCard key={s.id} shift={s} />)}</div>
              </div>
            )}
            {pastShifts.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t('myShifts.past')}</h2>
                <div className="space-y-2">{pastShifts.map(s => <ShiftCard key={s.id} shift={s} />)}</div>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
