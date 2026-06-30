import { Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { apiLookupActiveView } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { format } from 'date-fns';

interface Props {
  phone: string;
  className?: string;
}

/**
 * Live "currently being viewed by …" badge. Pulls active_call_views via
 * lookup endpoint (which sweeps expired views first, so we never show a
 * stale agent name). Hidden when nobody is viewing or when the viewer
 * is the current user (their PersonalListButton already shows that).
 */
export function ActiveViewBadge({ phone, className }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: view } = useQuery({
    queryKey: ['active-view-lookup', phone],
    queryFn: () => apiLookupActiveView(phone),
    enabled: !!phone && phone.replace(/\D/g, '').length >= 6,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  if (!view || view.agent_id === user?.id) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium cursor-help',
            'bg-blue-50 text-blue-800 ring-1 ring-blue-200',
            className,
          )}>
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
            <Eye className="h-3 w-3" />
            {t('activeView.onCustomer', { name: view.agent_name })}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[11px]">
          <div className="font-semibold">{view.agent_name}</div>
          <div className="opacity-70">{t('activeView.openedAt', { time: format(new Date(view.opened_at), 'HH:mm:ss') })}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
