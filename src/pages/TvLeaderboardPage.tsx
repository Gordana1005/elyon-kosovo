// Full-screen, always-on wall-board for the office TV. No login or app chrome:
// the access token rides in the URL (?key=...) and is validated server-side.
// Shows EVERY agent who was active that day (confirmed, called, or clocked in),
// with per-agent metrics + a personal daily bonus. Today updates live (~1s) via a
// Supabase Realtime broadcast on confirm, with a 20s polling fallback. A day
// switcher lets you review previous days. EUR-only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Trophy, Maximize2, Minimize2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import i18n, { SUPPORTED_LANGUAGES } from '@/i18n';
import { formatDate } from '@/i18n/dates';
import { apiGetLeaderboard, type LeaderboardResponse, type LeaderboardRow, type LeaderboardMode } from '@/lib/api';
import { formatMoney } from '@/lib/currency';

const POLL_MS = 20_000;
const REFETCH_DEBOUNCE_MS = 1_000;
const CELEBRATE_MS = 4_500;

const addDays = (ymd: string, delta: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};

// Module-level, so it reaches for the i18n singleton directly. The page itself
// subscribes via useTranslation(), so a language switch re-renders and re-calls it.
function dayLabel(day: string, offset: number) {
  if (offset === 0) return i18n.t('tvBoard.today');
  if (offset === 1) return i18n.t('tvBoard.yesterday');
  const [y, m, d] = day.split('-').map(Number);
  // Local midnight (not UTC) so the weekday never slips a day on a TV west of UTC.
  return formatDate(new Date(y, m - 1, d), 'EEE d MMM');
}

function initials(name: string) {
  return name.split(/[.\s_]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '–';
}

// Tasteful confetti (thin brand-colored strips, no emoji).
function Confetti() {
  const bits = useMemo(() => Array.from({ length: 36 }, (_, i) => ({
    id: i, left: Math.random() * 100, delay: Math.random() * 0.8, dur: 2.6 + Math.random() * 1.8,
    color: ['#34d399', '#818cf8', '#fbbf24', '#f9fafb', '#22d3ee'][i % 5], rot: Math.random() * 360,
  })), []);
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {bits.map((b) => (
        <span key={b.id} className="absolute -top-10 block"
          style={{ left: `${b.left}%`, width: '7px', height: '16px', background: b.color, borderRadius: '2px',
            transform: `rotate(${b.rot}deg)`, animation: `tv-fall ${b.dur}s cubic-bezier(.3,.1,.5,1) ${b.delay}s 1` }} />
      ))}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-[1.4vw] py-[1.4vh]">
      <div className="text-[1.4vh] font-medium uppercase tracking-[0.12em] text-slate-400">{label}</div>
      <div className="mt-[0.4vh] text-[3.4vh] font-bold leading-none tabular-nums text-slate-50">{value}</div>
    </div>
  );
}

const rankAccent: Record<number, string> = {
  1: 'bg-amber-300/15 text-amber-300 ring-amber-300/30',
  2: 'bg-slate-300/15 text-slate-200 ring-slate-300/30',
  3: 'bg-orange-400/15 text-orange-300 ring-orange-400/30',
};

export default function TvLeaderboardPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const key = params.get('key') || '';
  const langParam = params.get('lang') || '';

  // Public board — no login, so there is no profiles.language to read. ?lang=bg
  // pins the board's language per TV; without it the localStorage default wins.
  useEffect(() => {
    if (langParam && (SUPPORTED_LANGUAGES as string[]).includes(langParam) && i18n.language !== langParam) {
      void i18n.changeLanguage(langParam);
    }
  }, [langParam]);

  // Mode is seeded from ?mode= (so a TV can be pinned) but also togglable on screen.
  const [mode, setMode] = useState<LeaderboardMode>(params.get('mode') === 'pending' ? 'pending' : 'prediction');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0); // 0 = today, 1 = yesterday, ...
  const [now, setNow] = useState(() => new Date());
  const [celebrate, setCelebrate] = useState<{ agentId: string; at: number } | null>(null);
  const [isFs, setIsFs] = useState(false);
  const [cursorHidden, setCursorHidden] = useState(false);

  const toggleFullscreen = useCallback(() => {
    const el = document.documentElement as any;
    if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    } else {
      (document.exitFullscreen || (document as any).webkitExitFullscreen)?.call(document);
    }
  }, []);

  const anchorRef = useRef<string | null>(null); // server "today" once known
  const debounceRef = useRef<number | null>(null);
  const celebrateTimer = useRef<number | null>(null);

  const load = useCallback(async (ofs: number) => {
    if (!key) { setError(i18n.t('tvBoard.missingKey')); setLoading(false); return; }
    try {
      const reqDay = ofs > 0 && anchorRef.current ? addDays(anchorRef.current, -ofs) : undefined;
      const res = await apiGetLeaderboard(key, reqDay, mode);
      anchorRef.current = res.today;
      setData(res);
      setError(null);
    } catch (e: any) {
      setError(e?.message || i18n.t('tvBoard.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [key, mode]);

  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => { void load(0); }, REFETCH_DEBOUNCE_MS);
  }, [load]);

  const triggerCelebrate = useCallback((agentId?: string) => {
    if (!agentId) return;
    setCelebrate({ agentId, at: Date.now() });
    if (celebrateTimer.current) window.clearTimeout(celebrateTimer.current);
    celebrateTimer.current = window.setTimeout(() => setCelebrate(null), CELEBRATE_MS);
  }, []);

  // Load on key/offset change.
  useEffect(() => { setLoading(true); void load(offset); }, [load, offset]);

  // Poll only the live (today) view.
  useEffect(() => {
    if (offset !== 0) return;
    const id = window.setInterval(() => { void load(0); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load, offset]);

  // Live clock.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Track fullscreen state (button icon + browser F11/Esc).
  useEffect(() => {
    const onFs = () => setIsFs(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => { document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('webkitfullscreenchange', onFs); };
  }, []);

  // Hide the cursor after 3s idle (clean wall display); show it on mouse move so
  // the fullscreen button stays clickable.
  useEffect(() => {
    let t: number | undefined;
    const onMove = () => { setCursorHidden(false); if (t) window.clearTimeout(t); t = window.setTimeout(() => setCursorHidden(true), 3000); };
    onMove();
    window.addEventListener('mousemove', onMove);
    return () => { window.removeEventListener('mousemove', onMove); if (t) window.clearTimeout(t); };
  }, []);

  // Realtime broadcast — instant updates + celebration, today only.
  useEffect(() => {
    if (offset !== 0) return;
    const channel = supabase
      .channel('tv-leaderboard')
      .on('broadcast', { event: 'confirmed' }, ({ payload }: any) => { triggerCelebrate(payload?.agent_id); scheduleRefetch(); })
      .on('broadcast', { event: 'refresh' }, () => scheduleRefetch())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [offset, scheduleRefetch, triggerCelebrate]);

  // Keep the TV awake.
  useEffect(() => {
    let lock: any = null;
    const req = async () => { try { lock = await (navigator as any).wakeLock?.request('screen'); } catch { /* ignore */ } };
    void req();
    const onVis = () => { if (document.visibilityState === 'visible') void req(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); try { lock?.release?.(); } catch { /* ignore */ } };
  }, []);

  const isPred = mode === 'prediction';
  const agents: LeaderboardRow[] = data?.agents || [];
  const team = useMemo(() => {
    const confirmed = agents.reduce((s, a) => s + a.confirmed_count, 0);
    const revenue = agents.reduce((s, a) => s + (a.revenue || 0), 0);
    const price = agents.reduce((s, a) => s + a.avg_order_value * a.confirmed_count, 0);
    const calls = agents.reduce((s, a) => s + a.calls, 0);
    const bonus = agents.reduce((s, a) => s + a.bonus, 0);
    return { agents: agents.length, confirmed, revenue, calls, avg: confirmed ? price / confirmed : 0, sold: calls ? (confirmed / calls) * 100 : 0, bonus };
  }, [agents]);

  const label = data ? dayLabel(data.day, offset) : '';
  const pill = (active: boolean) =>
    `rounded-md px-[1vw] py-[0.6vh] text-[1.7vh] font-semibold transition ${active ? 'bg-indigo-500 text-white' : 'text-slate-300 hover:bg-white/10'}`;

  return (
    <div className={`flex min-h-screen w-screen flex-col overflow-hidden bg-gradient-to-b from-slate-950 to-slate-900 px-[2.2vw] py-[2.2vh] font-sans text-slate-100 ${cursorHidden ? 'cursor-none' : ''}`}>
      <style>{`@keyframes tv-fall{0%{transform:translateY(-12vh)}100%{transform:translateY(112vh)}}
        @keyframes tv-glow{0%,100%{background-color:rgba(52,211,153,0)}40%{background-color:rgba(52,211,153,0.16)}}`}</style>

      {celebrate && offset === 0 && <Confetti />}

      {/* Header */}
      <header className="mb-[2vh] flex items-center justify-between">
        <div className="flex items-center gap-[1.2vw]">
          <Trophy className="text-amber-300" style={{ width: '4vh', height: '4vh' }} />
          <div>
            <div className="text-[3vh] font-bold leading-none tracking-tight">{isPred ? t('tvBoard.titlePrediction') : t('tvBoard.titlePending')}</div>
            <div className="mt-[0.6vh] flex items-center gap-2 text-[1.6vh] text-slate-400">
              {offset === 0 && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />}
              <span>
                {offset === 0 ? t('tvBoard.live') : t('tvBoard.history')} ·{' '}
                {t('tvBoard.updated', { time: data ? new Date(data.generated_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—' })}
              </span>
            </div>
          </div>
          <div className="ml-[0.6vw] flex rounded-lg border border-white/10 bg-white/5 p-[0.4vh]">
            <button onClick={() => setMode('prediction')} className={pill(isPred)}>{t('tvBoard.modePrediction')}</button>
            <button onClick={() => setMode('pending')} className={pill(!isPred)}>{t('tvBoard.modePending')}</button>
          </div>
        </div>

        {/* Day switcher */}
        <div className="flex items-center gap-[0.8vw]">
          <button onClick={() => setOffset((o) => o + 1)}
            className="rounded-lg border border-white/10 bg-white/5 p-[1vh] text-slate-200 transition hover:bg-white/10">
            <ChevronLeft style={{ width: '2.6vh', height: '2.6vh' }} />
          </button>
          <div className="min-w-[14vw] text-center">
            <div className="text-[2.6vh] font-semibold leading-none">{label}</div>
            <div className="mt-[0.5vh] text-[1.5vh] text-slate-400">{data?.day || ''}</div>
          </div>
          <button onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0}
            className="rounded-lg border border-white/10 bg-white/5 p-[1vh] text-slate-200 transition hover:bg-white/10 disabled:opacity-30">
            <ChevronRight style={{ width: '2.6vh', height: '2.6vh' }} />
          </button>
        </div>

        <div className="flex items-center gap-[1vw]">
          <div className="text-[4.4vh] font-bold leading-none tabular-nums">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
          <button onClick={toggleFullscreen} title={isFs ? t('tvBoard.exitFullscreen') : t('tvBoard.fullscreen')}
            className="rounded-lg border border-white/10 bg-white/5 p-[1vh] text-slate-300 transition hover:bg-white/10">
            {isFs ? <Minimize2 style={{ width: '2.6vh', height: '2.6vh' }} /> : <Maximize2 style={{ width: '2.6vh', height: '2.6vh' }} />}
          </button>
        </div>
      </header>

      {/* KPI strip */}
      <div className="mb-[2vh] grid grid-cols-5 gap-[1vw]">
        <StatCard label={t('tvBoard.agentsOnline')} value={String(team.agents)} />
        <StatCard label={t('tvBoard.sales')} value={String(team.confirmed)} />
        {isPred
          ? <StatCard label={t('tvBoard.revenue')} value={formatMoney(team.revenue)} />
          : <StatCard label={t('tvBoard.soldRate')} value={`${team.sold.toFixed(1)}%`} />}
        <StatCard label={t('tvBoard.avgOrder')} value={formatMoney(team.avg)} />
        <StatCard label={t('tvBoard.bonusPool')} value={formatMoney(team.bonus)} />
      </div>

      {/* Team daily target (prediction only) — the shared goal for all agents */}
      {isPred && !loading && !error && data && (
        <div className="mb-[2vh] rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-[1.6vw] py-[1.4vh]">
          <div className="mb-[0.8vh] flex items-end justify-between">
            <span className="text-[1.6vh] font-semibold uppercase tracking-[0.12em] text-emerald-300">{t('tvBoard.teamTarget')}</span>
            <span className="text-[2.6vh] font-bold tabular-nums">
              {formatMoney(data.team_revenue)} <span className="text-[1.9vh] text-slate-400">/ {formatMoney(data.target)}</span>
              <span className="ml-[1vw] text-emerald-300">{data.team_target_pct.toFixed(0)}%</span>
            </span>
          </div>
          <div className="h-[2vh] w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-300 transition-all duration-700" style={{ width: `${Math.min(100, data.team_target_pct)}%` }} />
          </div>
        </div>
      )}

      {/* States */}
      {loading && <div className="mt-[18vh] text-center text-[2.6vh] text-slate-400">{t('common.loading')}</div>}
      {!loading && error && (
        <div className="mt-[18vh] text-center text-[2.6vh] text-rose-400">
          {error === 'Unauthorized' ? t('tvBoard.invalidKey') : error}
        </div>
      )}
      {!loading && !error && agents.length === 0 && (
        <div className="mt-[18vh] text-center text-[2.6vh] text-slate-400">{t('tvBoard.noAgents')}</div>
      )}

      {/* Table */}
      {!loading && !error && agents.length > 0 && (() => {
        const gridCls = isPred ? 'grid-cols-[6%_44%_16%_20%_14%]' : 'grid-cols-[6%_34%_18%_16%_14%_12%]';
        return (
        <div className="flex-1 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
          <div className={`grid ${gridCls} items-center px-[1.6vw] py-[1.3vh] text-[1.5vh] font-semibold uppercase tracking-[0.1em] text-slate-400`}>
            <div>#</div><div>{t('tvBoard.colAgent')}</div>
            <div className="text-center">{isPred ? t('tvBoard.sales') : t('tvBoard.colConfirmed')}</div>
            <div className="text-center">{isPred ? t('tvBoard.revenue') : t('tvBoard.avgOrder')}</div>
            {!isPred && <div className="text-center">{t('tvBoard.soldRate')}</div>}
            <div className="text-right">{t('tvBoard.colBonus')}</div>
          </div>
          <div>
            {agents.map((a) => {
              const live = celebrate?.agentId === a.user_id && offset === 0;
              return (
                <div key={a.user_id}
                  className={`grid ${gridCls} items-center border-t border-white/5 px-[1.6vw] py-[1.45vh] text-[3vh] ${a.rank % 2 ? 'bg-white/[0.015]' : ''}`}
                  style={live ? { animation: 'tv-glow 1.4s ease-in-out 2' } : undefined}>
                  {/* Rank */}
                  <div>
                    <span className={`inline-flex h-[4.4vh] w-[4.4vh] items-center justify-center rounded-full text-[2.2vh] font-bold ring-1 ${rankAccent[a.rank] || 'bg-white/5 text-slate-300 ring-white/10'}`}>{a.rank}</span>
                  </div>
                  {/* Agent */}
                  <div className="flex items-center gap-[0.9vw]">
                    <span className="inline-flex h-[4.6vh] w-[4.6vh] items-center justify-center rounded-full bg-indigo-500/20 text-[1.9vh] font-bold text-indigo-200">{initials(a.full_name)}</span>
                    <span className="truncate font-semibold">{a.full_name}</span>
                    {a.is_super && <span className="rounded bg-white/10 px-[0.5vw] py-[0.3vh] text-[1.3vh] font-medium uppercase tracking-wide text-slate-400">{t('tvBoard.adminBadge')}</span>}
                  </div>
                  {/* Sales / Confirmed */}
                  <div className="text-center font-bold tabular-nums">{a.confirmed_count}</div>
                  {/* Revenue (prediction) / Avg order (pending) */}
                  <div className="text-center font-semibold tabular-nums">{formatMoney(isPred ? a.revenue : a.avg_order_value)}</div>
                  {/* Sold rate (pending only) */}
                  {!isPred && <div className="text-center font-semibold tabular-nums">{a.sold_rate.toFixed(1)}%</div>}
                  {/* Bonus */}
                  <div className="text-right">
                    <span className={`inline-block rounded-lg px-[1vw] py-[0.5vh] text-[2.6vh] font-bold tabular-nums ${a.bonus > 0 ? 'bg-emerald-400/15 text-emerald-300' : a.bonus < 0 ? 'bg-rose-500/15 text-rose-300' : 'bg-white/5 text-slate-400'}`}>
                      {a.bonus > 0 ? formatMoney(a.bonus) : a.bonus < 0 ? `−${formatMoney(Math.abs(a.bonus))}` : formatMoney(0)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}
    </div>
  );
}
