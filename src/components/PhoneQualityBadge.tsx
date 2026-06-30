import { useState, useEffect } from 'react';
import { LeadQualityBadge } from '@/components/CustomerIntelligencePanel';
import { supabase } from '@/integrations/supabase/client';

const API_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api`;

// Global cache so we don't refetch during same session
const cache: Record<string, { score: string; reason: string } | null> = {};

interface Props {
  phone: string;
}

export function PhoneQualityBadge({ phone }: Props) {
  const [data, setData] = useState<{ score: string; reason: string } | null>(null);
  const [, setLoaded] = useState(false);

  useEffect(() => {
    const digits = phone.replace(/\D/g, '');
    const last8 = digits.length >= 8 ? digits.slice(-8) : digits;
    if (last8.length < 6) { setLoaded(true); return; }

    // Check cache
    if (cache[last8] !== undefined) {
      setData(cache[last8]);
      setLoaded(true);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) return;
        const res = await fetch(`${API_BASE}/customer-intelligence?phone=${encodeURIComponent(phone)}`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        });
        if (res.ok && !cancelled) {
          const json = await res.json();
          if (json.found && json.quality_score) {
            const result = { score: json.quality_score, reason: json.quality_reason || '' };
            cache[last8] = result;
            setData(result);
          } else {
            cache[last8] = null;
          }
        }
      } catch { /* silent */ }
      if (!cancelled) setLoaded(true);
    }, 100 + Math.random() * 400); // staggered to avoid burst

    return () => { cancelled = true; clearTimeout(timer); };
  }, [phone]);

  if (!data) return null;
  return <LeadQualityBadge score={data.score} reason={data.reason} />;
}
