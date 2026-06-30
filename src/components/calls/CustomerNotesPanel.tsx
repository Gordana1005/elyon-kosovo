import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Textarea } from '@/components/ui/textarea';
import { apiGetCustomerProfile, apiSaveCustomerNotes } from '@/lib/api';
import { NotebookPen, Check, Loader2 } from 'lucide-react';

type SaveState = 'idle' | 'saving' | 'saved';

/**
 * The "About this customer" notes board on the Calls page. A persistent,
 * free-form note keyed by phone (customer_profiles.notes) that any agent can
 * read before calling and edit during/after — relationship, health, who decides
 * in the household, objections, anything. Autosaves on blur via a notes-only
 * endpoint so it never clobbers the rest of the saved profile.
 */
export function CustomerNotesPanel({ phone }: { phone: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const phoneReady = phone.replace(/\D/g, '').length >= 6;

  const { data: profile } = useQuery({
    queryKey: ['customer-profile', phone],
    queryFn: () => apiGetCustomerProfile(phone),
    enabled: phoneReady,
    staleTime: 30_000,
  });

  const [draft, setDraft] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  // Last value we know is persisted — used to skip no-op saves on blur.
  const savedRef = useRef('');

  // Re-seed when the loaded profile or the customer changes.
  useEffect(() => {
    const loaded = (profile?.notes as string | null) ?? '';
    setDraft(loaded);
    savedRef.current = loaded;
    setSaveState('idle');
  }, [profile?.notes, phone]);

  const save = useMutation({
    mutationFn: (notes: string) => apiSaveCustomerNotes(phone, notes),
    onMutate: () => setSaveState('saving'),
    onSuccess: (_data, notes) => {
      savedRef.current = notes;
      setSaveState('saved');
      qc.invalidateQueries({ queryKey: ['customer-profile', phone] });
    },
    onError: () => setSaveState('idle'),
  });

  const handleBlur = () => {
    if (!phoneReady) return;
    if (draft === savedRef.current) return;
    save.mutate(draft);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          <NotebookPen className="h-3.5 w-3.5 text-blue-400" />
          {t('notesPanel.title')}
        </div>
        {saveState === 'saving' && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> {t('common.saving')}
          </span>
        )}
        {saveState === 'saved' && (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600">
            <Check className="h-3 w-3" /> {t('common.saved')}
          </span>
        )}
      </div>
      <Textarea
        value={draft}
        onChange={(e) => { setDraft(e.target.value); if (saveState === 'saved') setSaveState('idle'); }}
        onBlur={handleBlur}
        disabled={!phoneReady}
        placeholder={t('notesPanel.placeholder')}
        className="flex-1 min-h-[110px] resize-none text-sm bg-background"
        maxLength={4000}
      />
    </div>
  );
}
