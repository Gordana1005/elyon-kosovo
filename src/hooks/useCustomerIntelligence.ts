import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

const API_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api`;

export interface CustomerIntelligence {
  found: boolean;
  stats?: {
    total_orders: number;
    paid_orders: number;
    returned_orders: number;
    shipped_orders: number;
    confirmed_orders: number;
    lifetime_revenue: number;
    total_leads: number;
  };
  last_order?: {
    display_id: string;
    product: string;
    status: string;
    date: string;
    agent: string;
    price: number;
  } | null;
  quality_score?: 'HIGH' | 'MEDIUM' | 'RISK';
  quality_reason?: string;
  timeline?: any[];
  recommendations?: { product_id: string; product_name: string; frequency: number }[];
  customer_name?: string;
  orders_history?: {
    id: string;
    display_id: string;
    status: string;
    date: string;
    agent: string | null;
    price: number;
    source_type?: string;
    items: { product_name: string; quantity: number; price_per_unit: number; total_price: number }[];
    product_name_fallback?: string;
  }[];
  cooldown?: {
    is_in_cooldown: boolean;
    until: string;
    reason: string;
  } | null;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-8) : digits;
}

export function useCustomerIntelligence(phone: string) {
  const [data, setData] = useState<CustomerIntelligence | null>(null);
  const [loading, setLoading] = useState(false);
  const lastFetchedRef = useRef('');

  useEffect(() => {
    const normalized = normalizePhone(phone);
    if (normalized.length < 6) {
      setData(null);
      lastFetchedRef.current = '';
      return;
    }

    // Don't re-fetch if same normalized phone
    if (lastFetchedRef.current === normalized) return;

    const timer = setTimeout(async () => {
      setLoading(true);
      lastFetchedRef.current = normalized;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch(`${API_BASE}/customer-intelligence?phone=${encodeURIComponent(phone)}`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        });
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch {
        // silent fail
      } finally {
        setLoading(false);
      }
    }, 500); // debounce

    return () => clearTimeout(timer);
  }, [phone]);

  return { data, loading };
}
