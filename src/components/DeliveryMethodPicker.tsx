import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Home, Truck, MapPin, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { normalizeForSearch } from '@/lib/transliterate';
import { splitTrailingHouseNumber } from '@/lib/address';
import {
  apiGetCourierCities, apiGetCourierOffices, apiGetCourierOfficeByCode,
  apiSearchSettlements, apiSearchStreets, type BgSettlement,
} from '@/lib/api';

export type DeliveryType = 'home' | 'speedy_office' | 'econt_office';

export interface DeliveryValue {
  delivery_type: DeliveryType;
  // Home address fields
  street: string;
  street_number: string;  // house / building number (№) — kept separate from street
  quarter: string;        // квартал / ж.к. / к.к. — stored with its type prefix
  apartment: string;
  floor: string;
  block: string;          // блок (бл.) — formerly "building"
  entry: string;          // вход (вх.)
  city: string;
  postal_code: string;
  // Which courier delivers the home order (door delivery). Office orders carry
  // their courier in delivery_type instead.
  home_courier: 'speedy' | 'econt';
  // Courier-office fields
  courier_office_code: string;
  courier_office_name: string;
  courier_office_city: string;
}

interface Props {
  value: DeliveryValue;
  onChange: (next: DeliveryValue) => void;
  disabled?: boolean;
}

const COURIER_FROM_TYPE: Record<DeliveryType, 'speedy' | 'econt' | null> = {
  home: null,
  speedy_office: 'speedy',
  econt_office: 'econt',
};

export function DeliveryMethodPicker({ value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const courier = COURIER_FROM_TYPE[value.delivery_type];
  const isCourier = courier != null;

  const setHome = () => {
    if (value.delivery_type === 'home') return;
    onChange({ ...value, delivery_type: 'home' });
  };

  // Switch to office delivery. Default to Econt and clear any office selection
  // so a stale office from another courier can't linger (the picker holds only
  // one office field set). Editing an existing office order opens with Office
  // already active, so this never runs then — prefilled offices stay intact.
  const setOffice = () => {
    if (isCourier) return;
    onChange({ ...value, delivery_type: 'econt_office', courier_office_code: '', courier_office_name: '', courier_office_city: '' });
  };

  // Choose the office courier. Changing courier clears the office, because
  // Speedy and Econt have completely different offices and codes.
  const setOfficeCourier = (c: 'speedy' | 'econt') => {
    const t: DeliveryType = c === 'speedy' ? 'speedy_office' : 'econt_office';
    if (t === value.delivery_type) return;
    onChange({ ...value, delivery_type: t, courier_office_code: '', courier_office_name: '', courier_office_city: '' });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Pill
          active={value.delivery_type === 'home'}
          onClick={setHome}
          icon={<Home className="h-3.5 w-3.5" />}
          label={t('delivery.homeAddress')}
          disabled={disabled}
        />
        <Pill
          active={isCourier}
          onClick={setOffice}
          icon={<Truck className="h-3.5 w-3.5" />}
          label={t('delivery.office')}
          disabled={disabled}
        />
      </div>

      {value.delivery_type === 'home' && (
        <HomeFields value={value} onChange={onChange} disabled={disabled} />
      )}

      {isCourier && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Pill
              active={courier === 'speedy'}
              onClick={() => setOfficeCourier('speedy')}
              icon={<Truck className="h-3.5 w-3.5" />}
              label="Speedy"
              color="emerald"
              disabled={disabled}
            />
            <Pill
              active={courier === 'econt'}
              onClick={() => setOfficeCourier('econt')}
              icon={<Truck className="h-3.5 w-3.5" />}
              label="Econt"
              color="blue"
              disabled={disabled}
            />
          </div>
          <CourierFields
            courier={courier!}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

function Pill({ active, onClick, icon, label, color, disabled }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
  color?: 'emerald' | 'blue'; disabled?: boolean;
}) {
  const activeClass = color === 'emerald'
    ? 'bg-emerald-100 border-emerald-500 text-emerald-900'
    : color === 'blue'
      ? 'bg-blue-100 border-blue-500 text-blue-900'
      : 'bg-primary/10 border-primary text-primary';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'h-9 inline-flex items-center justify-center gap-1.5 rounded-md border-2 text-xs font-medium transition-colors',
        active ? activeClass : 'border-border text-muted-foreground hover:bg-muted',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function HomeFields({ value, onChange, disabled }: { value: DeliveryValue; onChange: (v: DeliveryValue) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const set = (k: keyof DeliveryValue, v: string) => onChange({ ...value, [k]: v });

  // When the agent types the house number into Street ("Гоце Делчев 18") and
  // leaves the № box empty, split it out on blur so it lands in its own field —
  // otherwise the warehouse CSV omits the "№ <n>" marker and the courier drops
  // the house number. No-op when № is already filled.
  const onStreetBlur = () => {
    const split = splitTrailingHouseNumber({ street: value.street, street_number: value.street_number });
    if (split.street_number !== value.street_number) {
      onChange({ ...value, street: split.street, street_number: split.street_number });
    }
  };

  // Track the picked settlement's Econt id so the Street field can suggest that
  // settlement's real streets + quarters. Resolved on pick, or looked up from
  // the prefilled city name when editing an existing order.
  const [settlementId, setSettlementId] = useState<string | null>(null);

  useEffect(() => {
    if (settlementId || !value.city) return;
    // Resolve the prefilled city to a settlement id (exact name match) so the
    // street autocomplete works when editing an existing order.
    let cancelled = false;
    const base = value.city.replace(/^\s*(гр\.?|с\.?|село|град)\s*/i, '').split(',')[0].trim();
    if (base.length < 2) return;
    apiSearchSettlements(base).then(list => {
      if (cancelled) return;
      const exact = list.find(s => s.name.toLowerCase() === base.toLowerCase()) || list[0];
      if (exact) setSettlementId(exact.id);
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.city]);

  const pickSettlement = (s: BgSettlement) => {
    setSettlementId(s.id);
    // Include the община for villages (where it differs from the settlement
    // name), e.g. "Чоба, общ. Брезово". For a town that is its own община
    // (Пловдив, общ. Пловдив) we keep just the name.
    const cityVal = s.municipality && s.municipality.toLowerCase() !== s.name.toLowerCase()
      ? `${s.name}, общ. ${s.municipality}`
      : s.name;
    onChange({ ...value, city: cityVal, postal_code: s.post_code || value.postal_code });
  };

  const homeCourier = value.home_courier || 'econt';

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Courier (compact) + City on one row */}
      <div className="col-span-2 flex gap-2 items-end">
        <div className="shrink-0">
          <label className="text-xs text-muted-foreground mb-1 block">{t('delivery.courier')}</label>
          <select
            value={homeCourier}
            onChange={e => onChange({ ...value, home_courier: e.target.value as 'speedy' | 'econt' })}
            disabled={disabled}
            className="h-8 w-28 rounded-md border bg-background text-sm px-2"
          >
            <option value="speedy">Speedy</option>
            <option value="econt">Econt</option>
          </select>
        </div>
        <div className="flex-1 min-w-0">
          <label className="text-xs text-muted-foreground mb-1 block">{t('delivery.cityVillage')}</label>
          <SettlementAutocomplete
            value={value.city}
            onText={(t) => { setSettlementId(null); set('city', t); }}
            onPick={pickSettlement}
            disabled={disabled}
          />
        </div>
      </div>
      <div className="col-span-2">
        <label className="text-xs text-muted-foreground mb-1 block">{t('delivery.quarterComplex')}</label>
        <QuarterField
          value={value.quarter}
          settlementId={settlementId}
          onChange={(t) => set('quarter', t)}
          disabled={disabled}
        />
      </div>
      {/* Street (wide) + house number (narrow) on one row */}
      <div className="col-span-2 flex gap-2 items-end">
        <div className="flex-1 min-w-0">
          <label className="text-xs text-muted-foreground mb-1 block">{t('delivery.street')}</label>
          <StreetAutocomplete
            value={value.street}
            settlementId={settlementId}
            onChange={(t) => set('street', t)}
            onBlur={onStreetBlur}
            disabled={disabled}
          />
        </div>
        <div className="w-20 shrink-0">
          <label className="text-xs text-muted-foreground mb-1 block">№</label>
          <Input value={value.street_number} onChange={e => set('street_number', e.target.value)} className="h-8 text-sm" disabled={disabled} />
        </div>
      </div>
      {/* Short numeric fields — compact 3-per-row grid (бл. вх. ет. ап. + postal) */}
      <div className="col-span-2 grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t('delivery.block')}</label>
          <Input value={value.block} onChange={e => set('block', e.target.value)} className="h-8 text-sm" disabled={disabled} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t('delivery.entry')}</label>
          <Input value={value.entry} onChange={e => set('entry', e.target.value)} className="h-8 text-sm" disabled={disabled} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t('delivery.floor')}</label>
          <Input value={value.floor} onChange={e => set('floor', e.target.value)} className="h-8 text-sm" disabled={disabled} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t('delivery.apartment')}</label>
          <Input value={value.apartment} onChange={e => set('apartment', e.target.value)} className="h-8 text-sm" disabled={disabled} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t('delivery.postalCode')}</label>
          <Input value={value.postal_code} onChange={e => set('postal_code', e.target.value)} className="h-8 text-sm" disabled={disabled} />
        </div>
      </div>
    </div>
  );
}

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

// City/village type-ahead over bg_settlements. Picking a row fills the city
// name + postal code and (via parent) wires the street autocomplete.
function SettlementAutocomplete({ value, onText, onPick, disabled }: {
  value: string; onText: (t: string) => void; onPick: (s: BgSettlement) => void; disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(value, 200);
  const { data: results = [] } = useQuery({
    queryKey: ['settlements', debounced],
    queryFn: () => apiSearchSettlements(debounced),
    enabled: open && debounced.trim().length >= 2,
    staleTime: 60_000,
  });
  return (
    <div className="relative">
      <Input
        value={value}
        onChange={e => { onText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={t('delivery.typeCityVillagePlaceholder')}
        className="h-8 text-sm"
        disabled={disabled}
      />
      {open && results.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto rounded-md border bg-popover shadow-lg">
          {results.map(s => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onPick(s); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center justify-between gap-2"
              >
                <span className="truncate">
                  {s.name}
                  {s.municipality && s.municipality.toLowerCase() !== s.name.toLowerCase() && (
                    <span className="text-muted-foreground"> · общ. {s.municipality}</span>
                  )}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">{[s.post_code, s.region].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Street type-ahead. Suggestions = the picked settlement's streets (Econt).
function StreetAutocomplete({ value, settlementId, onChange, onBlur, disabled }: {
  value: string; settlementId: string | null; onChange: (t: string) => void; onBlur?: () => void; disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(value, 200);
  const { data: results = [] } = useQuery({
    queryKey: ['streets', settlementId, debounced],
    queryFn: () => apiSearchStreets(settlementId!, debounced, 'street'),
    enabled: open && !!settlementId,
    staleTime: 60_000,
  });
  return (
    <div className="relative">
      <Input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setTimeout(() => setOpen(false), 150); onBlur?.(); }}
        placeholder={settlementId ? t('delivery.typeStreetPlaceholder') : t('delivery.pickCityFirstSuggestions')}
        className="h-8 text-sm"
        disabled={disabled}
      />
      {open && settlementId && results.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto rounded-md border bg-popover shadow-lg">
          {results.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(s); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted truncate"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Quarter / complex field: a type selector (кв. / ж.к. / к.к.) plus a name
// autocomplete drawn from the settlement's Econt quarters. The stored value is
// "{type} {name}" — the type is parsed back out of the stored value on edit.
const QUARTER_TYPES = ['кв.', 'ж.к.', 'к.к.'] as const;
function splitQuarter(v: string): { type: string; name: string } {
  const s = (v || '').trim();
  for (const t of ['ж.к.', 'жк', 'к.к.', 'кк', 'кв.', 'кв']) {
    if (s.toLowerCase().startsWith(t.toLowerCase())) {
      const norm = t.startsWith('ж') ? 'ж.к.' : t.startsWith('к') && t.length <= 2 ? 'к.к.' : t.startsWith('к.к') ? 'к.к.' : 'кв.';
      return { type: norm, name: s.slice(t.length).replace(/^[\s.]+/, '').trim() };
    }
  }
  return { type: 'кв.', name: s };
}
function QuarterField({ value, settlementId, onChange, disabled }: {
  value: string; settlementId: string | null; onChange: (t: string) => void; disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { type, name } = splitQuarter(value);
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(name, 200);
  const { data: results = [] } = useQuery({
    queryKey: ['quarters', settlementId, debounced],
    queryFn: () => apiSearchStreets(settlementId!, debounced, 'quarter'),
    enabled: open && !!settlementId,
    staleTime: 60_000,
  });
  const setType = (qtype: string) => onChange(name ? `${qtype} ${name}` : qtype);
  const setName = (n: string) => onChange(n ? `${type} ${n}` : '');
  // Picking a suggestion (already prefixed by Econt, e.g. "жк Люлин-3") replaces
  // the whole value so we don't double-prefix.
  const pick = (s: string) => { onChange(s); setOpen(false); };
  return (
    <div className="flex gap-2">
      <select
        value={type}
        onChange={e => setType(e.target.value)}
        disabled={disabled}
        className="h-8 rounded-md border bg-background text-sm px-2 shrink-0"
      >
        {QUARTER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <div className="relative flex-1">
        <Input
          value={name}
          onChange={e => { setName(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={settlementId ? t('delivery.typeQuarterPlaceholder') : t('delivery.quarterOptionalPlaceholder')}
          className="h-8 text-sm"
          disabled={disabled}
        />
        {open && settlementId && results.length > 0 && (
          <ul className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto rounded-md border bg-popover shadow-lg">
            {results.map((s, i) => (
              <li key={i}>
                <button
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => pick(s)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted truncate"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CourierFields({ courier, value, onChange, disabled }: {
  courier: 'speedy' | 'econt'; value: DeliveryValue; onChange: (v: DeliveryValue) => void; disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [cityQuery, setCityQuery] = useState(value.courier_office_city || '');
  const [officeQuery, setOfficeQuery] = useState('');
  const [showCityList, setShowCityList] = useState(false);
  const [showOfficeList, setShowOfficeList] = useState(false);

  // Keep cityQuery in sync when value changes from outside (e.g. pre-fill).
  useEffect(() => {
    setCityQuery(value.courier_office_city || '');
  }, [value.courier_office_city]);

  // Debounced city search
  const [cityDebounced, setCityDebounced] = useState(cityQuery);
  useEffect(() => {
    const t = setTimeout(() => setCityDebounced(cityQuery), 200);
    return () => clearTimeout(t);
  }, [cityQuery]);

  const { data: cities = [] } = useQuery({
    queryKey: ['courier-cities', courier, cityDebounced],
    queryFn: () => apiGetCourierCities(courier, cityDebounced, 15),
    enabled: showCityList,
    staleTime: 60_000,
  });

  const { data: offices = [] } = useQuery({
    queryKey: ['courier-offices', courier, value.courier_office_city],
    queryFn: () => apiGetCourierOffices(courier, value.courier_office_city),
    enabled: !!value.courier_office_city,
    staleTime: 60_000,
  });

  const selectedOffice = useMemo(
    () => offices.find(o => o.office_code === value.courier_office_code) || null,
    [offices, value.courier_office_code]
  );

  // For pre-fill on first render: if we have a saved code but the offices
  // list doesn't include it (e.g. city is empty), fetch the single office.
  const { data: savedOffice } = useQuery({
    queryKey: ['courier-by-code', courier, value.courier_office_code],
    queryFn: () => apiGetCourierOfficeByCode(courier, value.courier_office_code),
    enabled: !!value.courier_office_code && !selectedOffice && !value.courier_office_city,
    staleTime: 5 * 60_000,
  });

  const renderOffice = selectedOffice || savedOffice;

  // Sync the input text with the selection: when an office is picked from
  // outside (pre-fill) or from the dropdown, fill in "code — name".
  // When the user starts typing, that text becomes the search query.
  useEffect(() => {
    if (renderOffice) {
      setOfficeQuery(`${renderOffice.office_code} — ${renderOffice.name}`);
    } else if (!value.courier_office_code) {
      setOfficeQuery('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderOffice?.office_code]);

  // Filter the office list as the agent types — match the code, the name,
  // or the address (case-insensitive substring on each).
  const filteredOffices = useMemo(() => {
    // Normalize both query and fields via transliteration so Latin input
    // matches Cyrillic office data (e.g. "MLADOST" finds "Младост") and
    // vice-versa.
    const q = normalizeForSearch(officeQuery.trim());
    // If the query equals the currently-selected display string, treat it
    // as "no filter" so the agent can scroll the full list after re-opening.
    const selectedDisplay = renderOffice ? normalizeForSearch(`${renderOffice.office_code} — ${renderOffice.name}`) : '';
    if (!q || q === selectedDisplay) return offices;
    return offices.filter(o =>
      normalizeForSearch(o.office_code).includes(q) ||
      normalizeForSearch(o.name).includes(q) ||
      normalizeForSearch(o.address || '').includes(q)
    );
  }, [offices, officeQuery, renderOffice]);

  const pickCity = (c: string) => {
    setCityQuery(c);
    setShowCityList(false);
    onChange({
      ...value,
      courier_office_city: c,
      // Clear the office when city changes, unless the saved one belongs here
      courier_office_code: selectedOffice?.office_code === value.courier_office_code ? value.courier_office_code : '',
      courier_office_name: selectedOffice?.office_code === value.courier_office_code ? value.courier_office_name : '',
    });
    setShowOfficeList(true);
  };

  const pickOffice = (off: typeof offices[number]) => {
    onChange({
      ...value,
      courier_office_code: off.office_code,
      courier_office_name: off.name,
      courier_office_city: value.courier_office_city,
      // Office deliveries carry the courier office's own post code (the server
      // also enforces this on save).
      postal_code: off.post_code || value.postal_code,
    });
    setShowOfficeList(false);
  };

  const clearOffice = () => {
    onChange({ ...value, courier_office_code: '', courier_office_name: '' });
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <label className="text-xs text-muted-foreground mb-1 block">{t('delivery.city')}</label>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={cityQuery}
            onChange={e => { setCityQuery(e.target.value); setShowCityList(true); }}
            onFocus={() => setShowCityList(true)}
            onBlur={() => setTimeout(() => setShowCityList(false), 150)}
            placeholder={t('delivery.typeCityPlaceholder')}
            className="h-9 pl-8 text-sm"
            disabled={disabled}
          />
        </div>
        {showCityList && cities.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-md border bg-popover shadow-lg">
            {cities.map(c => (
              <li key={c.city}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickCity(c.city)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center justify-between"
                >
                  <span>{c.city}</span>
                  <span className="text-[10px] text-muted-foreground">{t('delivery.officesCount', { count: c.count })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="relative">
        <label className="text-xs text-muted-foreground mb-1 block">{t('delivery.office')}</label>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={officeQuery}
            onChange={(e) => {
              setOfficeQuery(e.target.value);
              setShowOfficeList(true);
            }}
            onFocus={(e) => {
              if (value.courier_office_city) {
                setShowOfficeList(true);
                // Select-all on focus so typing replaces the displayed name
                // when an office is already picked.
                e.target.select();
              }
            }}
            onBlur={() => setTimeout(() => setShowOfficeList(false), 150)}
            placeholder={value.courier_office_city ? t('delivery.searchOfficePlaceholder') : t('delivery.pickCityFirst')}
            className="h-9 pl-8 pr-8 text-sm"
            disabled={disabled || !value.courier_office_city}
          />
          {value.courier_office_code && !disabled && (
            <button
              type="button"
              onClick={clearOffice}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {showOfficeList && (
          <ul className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-md border bg-popover shadow-lg">
            {filteredOffices.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                {t('delivery.noOfficesMatch', { query: officeQuery, total: offices.length, city: value.courier_office_city })}
              </li>
            ) : filteredOffices.map(o => (
              <li key={o.office_code}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickOffice(o)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground">#{o.office_code}</span>
                    <span className="font-medium truncate">{o.name}</span>
                  </div>
                  {o.address && <div className="text-[11px] text-muted-foreground truncate">{o.address}</div>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {renderOffice && (
        <div className="rounded-md border bg-muted/30 p-2.5 text-xs space-y-0.5">
          <div className="flex items-center gap-1.5 font-semibold text-card-foreground">
            <MapPin className="h-3 w-3" />
            {renderOffice.city || value.courier_office_city} — #{renderOffice.office_code} {renderOffice.name}
          </div>
          {renderOffice.address && <div className="text-muted-foreground">{renderOffice.address}</div>}
          {renderOffice.hours && <div className="text-muted-foreground">{renderOffice.hours}</div>}
        </div>
      )}
    </div>
  );
}
