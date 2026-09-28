import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AppText, Card, EmptyView, Loading } from '../../components/ui';
import { LoadError, ModuleGuard, OfficeScreen, officeStyles, Pill, useOfficeData } from '../../features/office/ui';
import { officeApi } from '../../lib/api/office';

/** Documents & compliance, read-only: for each document type, how many are expired, due soon, missing or valid. */
function OfficeDocumentsBody() {
  const { t } = useTranslation();
  const summary = useOfficeData(officeApi.compliance);
  const rows = summary.data ?? [];

  return (
    <OfficeScreen title={t('office.nav.documents')} onRefresh={() => void summary.reload()} refreshing={summary.refreshing} testID="office-documents">
      {summary.error && <LoadError error={summary.error} onRetry={() => void summary.reload()} />}
      {summary.loading && !summary.data ? (
        <Loading />
      ) : rows.length === 0 && !summary.error ? (
        <EmptyView title={t('office.noDocuments')} />
      ) : (
        rows.map((row) => (
          <Card key={row.type} testID={`office-doc-${row.type}`}>
            <AppText variant="h2">{t(`office.docType.${row.type}`, { defaultValue: row.type })}</AppText>
            <View style={[officeStyles.row, { flexWrap: 'wrap', marginTop: 8 }]}>
              {row.expired > 0 && <Pill label={t('office.expiredCount', { count: row.expired })} tone="danger" />}
              {row.within7Days > 0 && <Pill label={t('office.soonCount', { count: row.within7Days })} tone="warning" />}
              {(row.notUploaded ?? 0) > 0 && <Pill label={t('office.missingCount', { count: row.notUploaded ?? 0 })} />}
              {row.pendingVerification > 0 && <Pill label={t('office.toVerifyCount', { count: row.pendingVerification })} tone="warning" />}
              <Pill label={t('office.validCount', { count: row.valid })} tone="success" />
            </View>
          </Card>
        ))
      )}
    </OfficeScreen>
  );
}

/** The guard renders first, so a role that may not open documents never calls its endpoints. */
export default function OfficeDocuments() {
  return (
    <ModuleGuard module="documents">
      <OfficeDocumentsBody />
    </ModuleGuard>
  );
}
