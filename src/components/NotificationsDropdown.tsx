import { useState, useEffect } from 'react';
import { Bell, CheckCheck, Clock, AlertTriangle, Info, Package, PhoneMissed, RotateCcw, PackageX, UserPlus, BadgeCheck, Copy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { formatDistanceToNow } from '@/i18n/dates';
import { cn } from '@/lib/utils';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  link: string | null;
  created_at: string;
}

// Pull the caller's number out of a missed-call notification so the row can offer
// a one-tap copy and a deep-link straight to that caller in the Missed Calls inbox.
// Prefer a structured `?phone=` on the link; otherwise fall back to the first
// phone-like digit run in the message (the trigger always embeds the number there).
function extractCallerPhone(n: Notification): string | null {
  if (n.type !== 'missed_call') return null;
  if (n.link && n.link.includes('phone=')) {
    const p = new URLSearchParams(n.link.split('?')[1] || '').get('phone');
    if (p) return p;
  }
  const m = n.message?.match(/\+?\d[\d\s().-]{6,}\d/);
  return m ? m[0].replace(/[\s().-]/g, '') : null;
}

const typeIcons: Record<string, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  shipment: Package,
  reminder: Clock,
  missed_call: PhoneMissed,
  order_returned: RotateCcw,
  order_paid: BadgeCheck,
  low_stock: PackageX,
  assignment: UserPlus,
};

const typeColors: Record<string, string> = {
  info: 'text-primary',
  warning: 'text-amber-500',
  shipment: 'text-emerald-500',
  reminder: 'text-blue-500',
  missed_call: 'text-rose-500',
  order_returned: 'text-pink-500',
  order_paid: 'text-emerald-500',
  low_stock: 'text-amber-500',
  assignment: 'text-primary',
};

// Per-type "mood" styling for unread items in the dropdown.
// Happy (paid) = emerald/gold uplifting tones
// Sad/refund = pinkish soft tones
// Urgent (missed, returns, low stock) keep strong warning colors.
// The small red dot remains a universal "unread/new" marker.
const getUnreadMoodClass = (type: string): string => {
  switch (type) {
    case 'order_paid':
      return 'bg-emerald-500/10 border-l-2 border-emerald-500 data-[highlighted]:bg-emerald-500/15 focus:bg-emerald-500/15';
    case 'order_returned':
      return 'bg-pink-500/10 border-l-2 border-pink-500 data-[highlighted]:bg-pink-500/15 focus:bg-pink-500/15';
    case 'missed_call':
      return 'bg-rose-500/10 border-l-2 border-rose-500 data-[highlighted]:bg-rose-500/15 focus:bg-rose-500/15';
    case 'low_stock':
      return 'bg-amber-500/10 border-l-2 border-amber-500 data-[highlighted]:bg-amber-500/15 focus:bg-amber-500/15';
    default:
      return 'bg-red-500/5 border-l-2 border-red-500 data-[highlighted]:bg-red-500/15 focus:bg-red-500/15';
  }
};

const getUnreadTitleClass = (type: string): string => {
  switch (type) {
    case 'order_paid':
      return 'font-semibold text-emerald-600 dark:text-emerald-400';
    case 'order_returned':
      return 'font-semibold text-pink-600 dark:text-pink-400';
    case 'missed_call':
      return 'font-semibold text-rose-600 dark:text-rose-400';
    case 'low_stock':
      return 'font-semibold text-amber-600 dark:text-amber-400';
    default:
      return 'font-semibold text-foreground';
  }
};

// How loud the arrival toast is, per type.
const toastSeverity: Record<string, 'error' | 'warning' | 'success' | 'default'> = {
  missed_call: 'error',
  order_returned: 'error',
  order_paid: 'success',
  low_stock: 'warning',
};

export function NotificationsDropdown() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const fetchNotifications = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) setNotifications(data as Notification[]);
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [user]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          // Pop a toast the instant a new notification lands (INSERT only — a
          // mark-as-read is an UPDATE and should stay silent).
          if (payload.eventType === 'INSERT' && payload.new) {
            const n = payload.new as Notification;
            renderNotificationToast(n);
          }
          fetchNotifications();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const markAsRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  // Clicking a notification marks it read and jumps to its target page (if any).
  // Missed calls deep-link straight to that caller in the inbox (?phone=…) so the
  // operator lands on the exact row instead of hunting through the list.
  const handleClick = (n: Notification) => {
    void markAsRead(n.id);
    setOpen(false);
    if (n.type === 'missed_call') {
      const phone = extractCallerPhone(n);
      navigate(phone ? `/missed-calls?phone=${encodeURIComponent(phone)}` : (n.link || '/missed-calls'));
      return;
    }
    if (n.link) navigate(n.link);
  };

  // Copy a caller's number straight from the dropdown without closing it.
  const copyPhone = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      toast.success(t('notif.numberCopied'), { description: phone });
    } catch {
      toast.error(t('notif.copyFailed'));
    }
  };

  const markAllAsRead = async () => {
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from('notifications').update({ is_read: true }).in('id', unreadIds);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button className="relative flex h-9 w-9 items-center justify-center rounded-lg border bg-background hover:bg-muted transition-colors">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white tabular-nums">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96">
        <div className="flex items-center justify-between px-4 py-3">
          <h3 className="font-semibold text-sm text-foreground">{t('notif.header')}</h3>
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <CheckCheck className="h-3 w-3" />
              {t('notif.markAllRead')}
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {/* Native overflow scroll — Radix ScrollArea eats wheel events inside a dropdown. */}
        <div className="max-h-96 overflow-y-auto overscroll-contain">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">{t('notif.empty')}</p>
            </div>
          ) : (
            notifications.map((n) => {
              const Icon = typeIcons[n.type] || Info;
              const baseColor = typeColors[n.type] || 'text-muted-foreground';
              const iconColor = baseColor;
              const isUnread = !n.is_read;
              const moodClass = isUnread ? getUnreadMoodClass(n.type) : '';
              const titleClass = isUnread ? getUnreadTitleClass(n.type) : 'text-muted-foreground';
              const phone = extractCallerPhone(n);
              // Universal small red dot = "this is still unread / new".
              // The bar + icon + title color now communicate the emotional tone (happy green, sad pink, urgent red).
              return (
                <DropdownMenuItem
                  key={n.id}
                  className={cn(
                    "flex gap-3 px-4 py-3 cursor-pointer",
                    isUnread && moodClass
                  )}
                  onClick={() => handleClick(n)}
                >
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${iconColor}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${titleClass}`}>
                      {n.title}
                    </p>
                    {n.message && (
                      <p className="text-xs text-muted-foreground break-words mt-0.5">{n.message}</p>
                    )}
                    {phone && (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onPointerUp={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); void copyPhone(phone); }}
                        className="mt-1.5 inline-flex items-center gap-1 rounded-md border bg-background/70 px-1.5 py-0.5 font-mono text-xs text-foreground hover:bg-muted hover:text-primary transition-colors"
                        title={t('notif.copyNumber')}
                      >
                        <Copy className="h-3 w-3 shrink-0" />
                        {phone}
                      </button>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  {isUnread && (
                    <div className="h-2 w-2 rounded-full bg-red-500 shrink-0 mt-1" />
                  )}
                </DropdownMenuItem>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------
   Personalized toast renderers + fun effects
   Order Paid  → happy uplifting + dollars raining (green/emerald)
   Refund      → pinkish + sad drifting 💸 
   Missed call → stays the urgent red treatment (toast.error)
------------------------------------------------------------------ */

function renderNotificationToast(n: Notification) {
  const description = n.message || undefined;

  if (n.type === 'order_paid') {
    toast.custom(
      (t) => <HappyOrderPaidToast t={t} n={n} />,
      { duration: 5200 }
    );
    return;
  }

  if (n.type === 'order_returned') {
    toast.custom(
      (t) => <SadRefundToast t={t} n={n} />,
      { duration: 4800 }
    );
    return;
  }

  // Fallback to the existing severity system for everything else
  // (missed_call stays loud/error, low_stock warning, etc.)
  const sev = toastSeverity[n.type] || 'default';
  const opts = description ? { description } : {};
  if (sev === 'error') toast.error(n.title, opts);
  else if (sev === 'warning') toast.warning(n.title, opts);
  else if (sev === 'success') toast.success(n.title, opts);
  else toast(n.title, opts);
}

function RainingMoney({
  color = 'text-emerald-500',
  count = 8,
  sad = false,
}: {
  color?: string;
  count?: number;
  sad?: boolean;
}) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-xl">
      {Array.from({ length: count }).map((_, i) => {
        const left = ((i * 17) % 88) + (i % 3) * 4;
        const delay = i * (sad ? 180 : 95);
        const duration = sad ? 1350 : 820;
        const anim = sad ? 'sad-drift' : 'money-rain';
        const symbol = sad ? '💸' : '$';
        return (
          <span
            key={i}
            className={`absolute text-lg font-bold select-none ${color}`}
            style={{
              left: `${left}%`,
              top: sad ? '25%' : '-4px',
              animation: `${anim} ${duration}ms linear ${delay}ms forwards`,
              opacity: sad ? 0.65 : 0.9,
            }}
          >
            {symbol}
          </span>
        );
      })}
    </div>
  );
}

function HappyOrderPaidToast({ t, n }: { t: { id: string | number }; n: Notification }) {
  return (
    <div className="relative w-full max-w-[340px] overflow-hidden rounded-xl border border-emerald-500/40 bg-background p-4 shadow-xl">
      <div className="flex items-start gap-3 pr-5">
        <div className="text-3xl leading-none mt-px">🎉</div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-emerald-600 dark:text-emerald-400 text-[15px] tracking-[-0.2px]">
            {i18n.t('notif.congrats')}
          </div>
          <div className="mt-0.5 text-sm font-medium leading-snug text-foreground">
            {n.title}
          </div>
          {n.message && (
            <div className="mt-1 text-xs text-muted-foreground leading-snug">
              {n.message}
            </div>
          )}
          <div className="mt-1 text-[10px] text-emerald-500/80 font-medium">{i18n.t('notif.kaChing')}</div>
        </div>
      </div>

      <RainingMoney color="text-emerald-400 dark:text-emerald-500" count={9} />

      <button
        onClick={() => toast.dismiss(t.id)}
        className="absolute right-1.5 top-1.5 rounded p-1 text-emerald-600/60 hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors"
        aria-label={i18n.t('common.close')}
      >
        ×
      </button>
    </div>
  );
}

function SadRefundToast({ t, n }: { t: { id: string | number }; n: Notification }) {
  return (
    <div className="relative w-full max-w-[340px] overflow-hidden rounded-xl border border-pink-500/40 bg-background p-4 shadow-xl">
      <div className="flex items-start gap-3 pr-5">
        <div className="text-3xl leading-none mt-px opacity-80">💔</div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-pink-600 dark:text-pink-400 text-[15px]">
            {i18n.t('notif.refundProcessed')}
          </div>
          <div className="mt-0.5 text-sm font-medium leading-snug text-foreground">
            {n.title}
          </div>
          {n.message && (
            <div className="mt-1 text-xs text-muted-foreground leading-snug">
              {n.message}
            </div>
          )}
          <div className="mt-1 text-[10px] text-pink-500/70">{i18n.t('notif.nextOne')}</div>
        </div>
      </div>

      <RainingMoney color="text-pink-400/90 dark:text-pink-500/90" count={5} sad />

      <button
        onClick={() => toast.dismiss(t.id)}
        className="absolute right-1.5 top-1.5 rounded p-1 text-pink-600/60 hover:text-pink-600 hover:bg-pink-500/10 transition-colors"
        aria-label={i18n.t('common.close')}
      >
        ×
      </button>
    </div>
  );
}
