import { useTranslation } from 'react-i18next';
import { CalculatorPanel } from '@/features/calculator/CalculatorPanel';
import { PageHeader } from '../components/ui';

export function CalculatorPage() {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader title={t('admin.calc.title')} description={t('admin.calc.subtitle')} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,640px)_1fr]">
        <section className="panel p-5">
          <CalculatorPanel />
        </section>
        <aside className="space-y-3 text-sm text-muted-foreground">
          <div className="panel p-4">
            <p className="font-semibold text-foreground">{t('admin.calc.tipTitle')}</p>
            <p className="mt-1">{t('admin.calc.tip')}</p>
          </div>
          <div className="panel p-4">
            <p className="font-semibold text-foreground">{t('admin.calc.shortcutTitle')}</p>
            <p className="mt-1">{t('admin.calc.shortcut')}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
