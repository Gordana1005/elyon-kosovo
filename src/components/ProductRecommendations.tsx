import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

interface Recommendation {
  product_id: string;
  product_name: string;
  frequency: number;
}

interface Props {
  recommendations: Recommendation[];
  currentProductNames: string[];
  onAdd: (productId: string, productName: string) => void;
  disabled?: boolean;
}

export function ProductRecommendations({ recommendations, currentProductNames, onAdd, disabled }: Props) {
  const { t } = useTranslation();
  // Filter out products already in the order
  const filtered = recommendations.filter(
    r => !currentProductNames.some(name => name.toLowerCase() === r.product_name.toLowerCase())
  );

  if (filtered.length === 0) return null;

  return (
    <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-2.5 space-y-1.5">
      <h4 className="text-[10px] font-semibold text-primary uppercase tracking-wider">
        {t('recs.suggestedAddons')}
      </h4>
      <div className="flex flex-wrap gap-1.5">
        {filtered.slice(0, 3).map(r => (
          <Button
            key={r.product_id}
            variant="outline"
            size="sm"
            className="h-6 text-[11px] gap-1 border-primary/30 text-primary hover:bg-primary/10"
            onClick={() => onAdd(r.product_id, r.product_name)}
            disabled={disabled}
          >
            <Plus className="h-3 w-3" />
            {r.product_name}
          </Button>
        ))}
      </div>
    </div>
  );
}
