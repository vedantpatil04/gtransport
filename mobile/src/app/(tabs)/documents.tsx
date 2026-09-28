import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '../../components/OfflineBanner';
import { AppText, Card, ErrorView, Loading } from '../../components/ui';
import { documentsApi, type ComplianceItem, type MyDocuments } from '../../lib/api/documents';
import { receiptSource } from '../../lib/api/operations';
import { useSession } from '../../lib/auth/session-store';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';

/**
 * The driver's documents: their vehicle's RC, insurance, PUC and tyre insurance, and their own
 * licence. Each card says plainly whether it is valid, expiring, expired or missing — status is
 * worked out by the server, never guessed on the phone.
 */
export default function DocumentsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const token = useSession((s) => s.token);
  const [data, setData] = useState<MyDocuments | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewing, setViewing] = useState<ComplianceItem | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setData(await documentsApi.mine(token));
      setError(false);
    } catch {
      setError(true);
    }
  }, [token]);

  // Reload whenever the tab is shown, e.g. after uploading a document.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const open = (item: ComplianceItem) =>
    router.push({ pathname: '/document/upload', params: { type: item.type, ...(item.document ? { replace: '1' } : {}) } });

  return (
    <View style={styles.flex}>
      <OfflineBanner />
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <AppText variant="h1" tone="inverse">
          {t('docs.title')}
        </AppText>
      </View>

      {!data && error ? (
        <ErrorView onRetry={() => void load()} />
      ) : !data ? (
        <Loading />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              tintColor={colors.primary}
            />
          }
        >
          <AppText variant="h2">
            {t('docs.vehicleDocs')}
            {data.vehicle ? ` · ${data.vehicle.registrationNumber}` : ''}
          </AppText>
          {data.vehicle ? (
            data.vehicle.documents.map((item) => <DocumentCard key={item.type} item={item} onView={setViewing} onUpload={open} />)
          ) : (
            <AppText tone="muted">{t('docs.noVehicle')}</AppText>
          )}

          <AppText variant="h2" style={{ marginTop: spacing.md }}>
            {t('docs.myDocs')}
          </AppText>
          {data.personal.map((item) => (
            <DocumentCard key={item.type} item={item} onView={setViewing} onUpload={open} />
          ))}
        </ScrollView>
      )}

      <Modal visible={Boolean(viewing)} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <Pressable style={styles.backdrop} onPress={() => setViewing(null)} accessibilityRole="button">
          {viewing?.document?.file && token ? (
            viewing.document.file.mimeType === 'application/pdf' ? (
              <AppText tone="inverse">{`${t('docs.pdf')} · ${viewing.document.file.fileName}`}</AppText>
            ) : (
              <Image source={receiptSource(token, viewing.document.file.id)} style={styles.image} resizeMode="contain" accessibilityLabel={t(`docs.${viewing.type}`)} />
            )
          ) : null}
          <AppText tone="inverse" style={{ marginTop: spacing.lg }}>
            {t('common.close')}
          </AppText>
        </Pressable>
      </Modal>
    </View>
  );
}

/** One document: its name, a plain status line, verification, and the actions that make sense. */
function DocumentCard({
  item,
  onView,
  onUpload,
}: {
  item: ComplianceItem;
  onView: (item: ComplianceItem) => void;
  onUpload: (item: ComplianceItem) => void;
}) {
  const { t } = useTranslation();
  const doc = item.document;

  const status = (() => {
    switch (item.status) {
      case 'NOT_UPLOADED':
        return { text: t('docs.notUploaded'), tone: 'muted' as const, dot: colors.border };
      case 'EXPIRED':
        return { text: t('docs.expiredAgo', { count: Math.abs(item.daysRemaining ?? 0) }), tone: 'danger' as const, dot: colors.danger };
      case 'EXPIRING_SOON':
        return {
          text: item.daysRemaining === 0 ? t('docs.expiresToday') : t('docs.expiresIn', { count: item.daysRemaining ?? 0 }),
          tone: 'warning' as const,
          dot: colors.warning,
        };
      default:
        return { text: item.daysRemaining === null ? t('docs.noExpiry') : t('docs.valid'), tone: 'success' as const, dot: colors.success };
    }
  })();

  const verification =
    doc?.verificationStatus === 'VERIFIED'
      ? { text: t('docs.verified'), tone: 'success' as const }
      : doc?.verificationStatus === 'REJECTED'
        ? { text: t('docs.needsAttention'), tone: 'danger' as const }
        : doc
          ? { text: t('docs.underReview'), tone: 'muted' as const }
          : null;

  return (
    <Card style={styles.card} testID={`doc-${item.type}`}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: status.dot }]} />
        <View style={styles.flexText}>
          <AppText variant="h2" numberOfLines={2}>
            {t(`docs.${item.type}`)}
          </AppText>
          <AppText tone={status.tone} testID={`doc-status-${item.type}`}>
            {status.text}
          </AppText>
          {verification ? (
            <AppText variant="label" tone={verification.tone}>
              {verification.text}
              {doc?.verificationStatus === 'REJECTED' && doc.rejectionReason ? ` · ${doc.rejectionReason}` : ''}
            </AppText>
          ) : null}
        </View>
      </View>
      <View style={styles.actions}>
        {doc?.file ? (
          <Pressable accessibilityRole="button" onPress={() => onView(item)} style={styles.action}>
            <AppText tone="success">{t('docs.view')}</AppText>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => onUpload(item)} style={styles.action} testID={`doc-upload-${item.type}`}>
          <AppText tone="success">{doc ? t('docs.replace') : t('docs.upload')}</AppText>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  flexText: { flex: 1, gap: 2 },
  header: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  body: { padding: spacing.lg, gap: spacing.md },
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 6 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  action: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  image: { width: '100%', height: '80%' },
});
