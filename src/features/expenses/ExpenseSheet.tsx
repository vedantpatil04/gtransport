import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { FileView } from '@/components/media/FileView';
import { DetailList, DriverCell } from '@/features/admin/components/ui';
import { UPDATE_META } from '@/features/driver/updateMeta';
import { fmtDate, fmtDateTime, inr } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useApp } from '@/store';
import type { Expense } from '@/types';

export const EXPENSE_STATUS_TONE: Record<Expense['status'], 'neutral' | 'success' | 'danger'> = { submitted: 'neutral', approved: 'success', rejected: 'danger' };

export function ExpenseSheet({ expenseId, onClose }: { expenseId: string | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const expense = useApp((s) => s.expenses.find((e) => e.id === expenseId));
  const driver = useApp((s) => s.drivers.find((d) => d.id === expense?.driverId));
  const vehicle = useApp((s) => s.vehicles.find((v) => v.id === expense?.vehicleId));
  const setStatus = (status: Expense['status']) => {
    if (!expense) return;
    useApp.getState().setExpenseStatus(expense.id, status);
    toast.success(t(status === 'approved' ? 'admin.expenses.approvedToast' : 'admin.expenses.rejectedToast'), { description: `${inr(expense.amount)} · ${driver?.name ?? ''}` });
  };
  const meta = expense ? UPDATE_META[expense.category] : null;
  const Icon = meta?.icon;
  return (
    <Sheet open={!!expense} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full max-w-[460px] overflow-y-auto">
        {expense && meta && Icon && (
          <div className="space-y-5 p-5" data-testid="expense-sheet">
            <div className="flex items-center gap-3 pr-8">
              <span className={cn('flex size-10 items-center justify-center rounded-lg', meta.tint)}>
                <Icon className="size-5" />
              </span>
              <div>
                <SheetTitle>{t(`enum.category.${expense.category}`)}</SheetTitle>
                <p className="text-sm text-muted-foreground">{fmtDateTime(expense.createdAt, i18n.language)}</p>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <p className="figure text-3xl font-bold">{inr(expense.amount)}</p>
              <Badge tone={EXPENSE_STATUS_TONE[expense.status]} className="text-sm">
                {t(`enum.expenseStatus.${expense.status}`)}
              </Badge>
            </div>
            {expense.status === 'submitted' && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="success" onClick={() => setStatus('approved')} data-testid="expense-approve">
                  <Check />
                  {t('admin.expenses.approve')}
                </Button>
                <Button variant="outline" className="text-danger hover:text-danger" onClick={() => setStatus('rejected')}>
                  <X />
                  {t('admin.expenses.reject')}
                </Button>
              </div>
            )}
            <DetailList
              rows={[
                [t('admin.common.driver'), <DriverCell driver={driver} />],
                [t('admin.common.vehicle'), <Plate reg={vehicle?.reg} size="xs" />],
                [t('common.note'), expense.note || '—'],
                [t('admin.common.date'), fmtDate(expense.date, i18n.language)],
                [t('admin.expenses.enteredBy'), expense.enteredBy === 'driver' ? t('admin.fuel.driverApp') : t('admin.expenses.office')],
              ]}
            />
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t('admin.expenses.bill')}</h3>
              {expense.receipt ? <FileView file={expense.receipt} alt={t('admin.expenses.bill')} /> : <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('admin.expenses.noBill')}</p>}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
