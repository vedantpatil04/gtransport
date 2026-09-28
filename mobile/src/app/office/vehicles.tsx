import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';
import { AppText, Card, EmptyView, Loading, Plate } from '../../components/ui';
import { DASH, LoadError, ModuleGuard, OfficeScreen, officeStyles, Pill, ShowMore, useDebounced, usePagedList } from '../../features/office/ui';
import { officeApi } from '../../lib/api/office';
import { colors } from '../../theme/tokens';

const STATUS_TONE = { ACTIVE: 'success', MAINTENANCE: 'warning', IDLE: 'default', RETIRED: 'default' } as const;

/** Vehicles, read-only: registration, driver, status and ownership, with search. */
function OfficeVehiclesBody() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const list = usePagedList((token, cursor) => officeApi.vehicles(token, { q: search || undefined, limit: 30, cursor }), [search]);

  return (
    <OfficeScreen title={t('office.nav.vehicles')} onRefresh={() => void list.reload()} refreshing={list.refreshing} testID="office-vehicles">
      <TextInput
        style={officeStyles.search}
        value={q}
        onChangeText={setQ}
        placeholder={t('office.searchVehicles')}
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="characters"
        accessibilityLabel={t('office.searchVehicles')}
        testID="office-vehicle-search"
      />
      {list.error && <LoadError error={list.error} onRetry={() => void list.reload()} />}
      {list.loading ? (
        <Loading />
      ) : list.rows.length === 0 && !list.error ? (
        <EmptyView title={search ? t('office.noResults') : t('office.noVehicles')} />
      ) : (
        list.rows.map((v) => (
          <Card key={v.id} testID={`office-vehicle-${v.id}`}>
            <View style={officeStyles.row}>
              <Plate reg={v.registrationNumber} size="sm" />
              <View style={officeStyles.grow}>
                <AppText numberOfLines={1}>{[v.make, v.model].filter(Boolean).join(' ') || DASH}</AppText>
                <AppText variant="label" tone="muted" numberOfLines={1}>{v.currentAssignment?.driver.fullName ?? t('office.noDriver')}</AppText>
              </View>
            </View>
            <View style={[officeStyles.row, { marginTop: 8 }]}>
              <Pill label={t(`office.vehicleStatus.${v.status}`)} tone={STATUS_TONE[v.status]} />
              <Pill label={t(`office.ownership.${v.ownership}`)} />
            </View>
          </Card>
        ))
      )}
      <ShowMore list={list} />
    </OfficeScreen>
  );
}

/** The guard renders first, so a role that may not open vehicles never calls its endpoints. */
export default function OfficeVehicles() {
  return (
    <ModuleGuard module="vehicles">
      <OfficeVehiclesBody />
    </ModuleGuard>
  );
}
