import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';
import { AppText, Card, EmptyView, Loading } from '../../components/ui';
import { LoadError, ModuleGuard, OfficeScreen, officeStyles, Pill, ShowMore, useDebounced, usePagedList } from '../../features/office/ui';
import { officeApi } from '../../lib/api/office';
import { colors } from '../../theme/tokens';

const STATUS_TONE = { ACTIVE: 'success', ON_LEAVE: 'warning', SUSPENDED: 'danger', INACTIVE: 'default', EXITED: 'default' } as const;

/** Employees, read-only: who they are and their status. Account management stays in the office console. */
function OfficeEmployeesBody() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const list = usePagedList((token, cursor) => officeApi.employees(token, { q: search || undefined, limit: 30, cursor }), [search]);

  return (
    <OfficeScreen title={t('office.nav.employees')} onRefresh={() => void list.reload()} refreshing={list.refreshing} testID="office-employees">
      <TextInput
        style={officeStyles.search}
        value={q}
        onChangeText={setQ}
        placeholder={t('office.searchEmployees')}
        placeholderTextColor={colors.mutedForeground}
        accessibilityLabel={t('office.searchEmployees')}
        testID="office-employee-search"
      />
      {list.error && <LoadError error={list.error} onRetry={() => void list.reload()} />}
      {list.loading ? (
        <Loading />
      ) : list.rows.length === 0 && !list.error ? (
        <EmptyView title={search ? t('office.noResults') : t('office.noEmployees')} />
      ) : (
        list.rows.map((e) => (
          <Card key={e.id} testID={`office-employee-${e.id}`}>
            <View style={officeStyles.row}>
              <View style={officeStyles.grow}>
                <AppText variant="h2" numberOfLines={1}>{e.fullName}</AppText>
                <AppText variant="label" tone="muted" numberOfLines={1}>
                  {e.employeeCode} · {t(`office.employeeRole.${e.role}`, { defaultValue: e.role })}
                  {e.phone ? ` · ${e.phone}` : ''}
                </AppText>
              </View>
              <Pill label={t(`office.employmentStatus.${e.status}`)} tone={STATUS_TONE[e.status]} />
            </View>
          </Card>
        ))
      )}
      <ShowMore list={list} />
    </OfficeScreen>
  );
}

/** The guard renders first, so a role that may not open employees never calls its endpoints. */
export default function OfficeEmployees() {
  return (
    <ModuleGuard module="employees">
      <OfficeEmployeesBody />
    </ModuleGuard>
  );
}
