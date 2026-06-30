import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FulfilmentField, FulfilmentOrder } from '@/lib/fulfilmentValidation';

export interface InvalidOrder {
  order: FulfilmentOrder;
  missing: FulfilmentField[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Orders that passed validation and will be exported & shipped. */
  validCount: number;
  /** Orders that failed validation, with their missing-field codes. */
  invalid: InvalidOrder[];
  /** Proceed with the valid orders only (held-back orders stay confirmed). */
  onExportValid: () => void;
}

// Stable field code → i18n label key.
const FIELD_LABEL: Record<FulfilmentField, string> = {
  name: 'ordersPage.fieldName',
  phone: 'ordersPage.fieldPhone',
  postal_code: 'ordersPage.fieldPostalCode',
  product: 'ordersPage.fieldProduct',
  price: 'ordersPage.fieldPrice',
  address: 'ordersPage.fieldAddress',
  house_number: 'ordersPage.fieldHouseNumber',
  office: 'ordersPage.fieldOffice',
  data_hidden: 'ordersPage.dataHiddenByPrivacy',
};

/**
 * Pre-export gate for the Daily Fulfilment CSV. Lists every order that's missing
 * details the warehouse needs and lets the operator either fix them first or
 * export just the complete ones (the rest stay Confirmed for a clean re-export).
 */
export function FulfilmentValidationDialog({ open, onOpenChange, validCount, invalid, onExportValid }: Props) {
  const { t } = useTranslation();
  const total = validCount + invalid.length;
  const hasValid = validCount > 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {t('ordersPage.exportValidationTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {hasValid
              ? t('ordersPage.exportValidationDesc', { invalid: invalid.length, total, valid: validCount })
              : t('ordersPage.exportAllInvalid', { total })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="max-h-72 space-y-2 overflow-y-auto py-1 pr-1">
          {invalid.map(({ order, missing }) => (
            <li key={order.id} className="rounded-md border-l-2 border-amber-500 bg-muted/40 px-3 py-1.5">
              <div className="text-sm font-medium text-foreground">
                #{order.display_id}{order.customer_name ? ` — ${order.customer_name}` : ''}
              </div>
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">{t('ordersPage.missingLabel')}:</span>{' '}
                {missing.map((m) => t(FIELD_LABEL[m])).join(', ')}
              </div>
            </li>
          ))}
        </ul>

        <AlertDialogFooter>
          <AlertDialogCancel>{t('ordersPage.fixFirst')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onExportValid}
            disabled={!hasValid}
            className={cn(!hasValid && 'pointer-events-none opacity-50')}
          >
            {t('ordersPage.exportValidOnly', { count: validCount })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
