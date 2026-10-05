import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AppText, Card, EmptyView, Loading, Plate } from '../../components/ui';
import { DASH, LoadError, ModuleGuard, OfficeScreen, officeStyles, ShowMore, StatTile, useOfficeData, usePagedList } from '../../features/office/ui';
import { officeApi } from '../../lib/api/office';
import { quantity, rupees } from '../../lib/format';
import { displayDate } from '../../lib/dates';

/** Fuel, read-only: today, this month and the financial year, then the latest entries. */
function OfficeFuelBody() {
  const { t, i18n } = useTranslation();
  const summary = useOfficeData(officeApi.fuelSummary);
  const list = usePagedList((token, cursor) => officeApi.fuel(token, { limit: 20, cursor }));
  const refresh = async () => {
    await Promise.all([summary.reload(), list.reload()]);
  };

  return (
    <OfficeScreen title={t('office.nav.fuel')} subtitle={summary.data?.financialYear.label} onRefresh={() => void refresh()} refreshing={list.refreshing} testID="office-fuel">
      {(summary.error ?? list.error) && <LoadError error={(summary.error ?? list.error)!} onRetry={() => void refresh()} />}
      <View style={officeStyles.grid}>
        <View style={officeStyles.half}>
          <StatTile label={t('office.today')} value={summary.data ? rupees(summary.data.today.amount) : DASH} sub={summary.data ? t('office.litres', { litres: quantity(summary.data.today.litres, 1) }) : undefined} />
        </View>
        <View style={officeStyles.half}>
          <StatTile label={t('office.thisMonth')} value={summary.data ? rupees(summary.data.month.amount) : DASH} sub={summary.data ? t('office.litres', { litres: quantity(summary.data.month.litres, 1) }) : undefined} />
        </View>
      </View>
      <StatTile
        label={t('office.financialYear')}
        value={summary.data ? rupees(summary.data.financialYear.amount) : DASH}
        sub={summary.data ? t('office.litresEntries', { litres: quantity(summary.data.financialYear.litres, 1), count: summary.data.financialYear.entries }) : undefined}
      />

      <AppText variant="h2" style={{ marginTop: 4 }}>{t('office.latestEntries')}</AppText>
      {list.loading ? (
        <Loading />
      ) : list.rows.length === 0 && !list.error ? (
        <EmptyView title={t('office.noFuel')} />
      ) : (
        list.rows.map((f) => (
          <Card key={f.id}>
            <View style={officeStyles.row}>
              <Plate reg={f.vehicle.registrationNumber} size="sm" />
              <View style={officeStyles.grow}>
                <AppText numberOfLines={1}>{f.driver.fullName}</AppText>
                <AppText variant="label" tone="muted" numberOfLines={1}>
                  {displayDate(f.transactionDate.slice(0, 10), i18n.language)} · {t(`office.fuelType.${f.fuelType}`)} · {t('office.litres', { litres: quantity(f.litres) })}
                </AppText>
              </View>
              <AppText variant="h2">{rupees(f.amount)}</AppText>
            </View>
          </Card>
        ))
      )}
      <ShowMore list={list} />
    </OfficeScreen>
  );
}

/** The guard renders first, so a role that may not open fuel never calls its endpoints. */
export default function OfficeFuel() {
  return (
    <ModuleGuard module="fuel">
      <OfficeFuelBody />
    </ModuleGuard>
  );
}
