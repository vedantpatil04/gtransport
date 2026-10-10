import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DateField, Field, TextField } from '../../components/form';
import { AppText, PrimaryButton } from '../../components/ui';
import { ApiError } from '../../lib/api/client';
import { documentsApi, uploadDocumentFile, type DocumentType } from '../../lib/api/documents';
import { useSession } from '../../lib/auth/session-store';
import { chooseFile, chooseFromGallery, takePhoto, type CaptureResult } from '../../lib/receipts/capture';
import { discardReceipt, type LocalReceipt } from '../../lib/receipts/storage';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';

const TYPES: DocumentType[] = ['RC', 'INSURANCE', 'PUC', 'TYRE_INSURANCE', 'DRIVING_LICENCE'];

/**
 * What to tell the driver when saving failed. Every message says what is true and what to do next —
 * and that the file and the details they typed are still here. Server refusals (a wrong file type,
 * no vehicle assigned) are shown as the server worded them.
 */
export function describeUploadFailure(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    const reference = error.requestId ? ` ${t('daily.reference', { id: error.requestId.slice(0, 8) })}` : '';
    switch (error.kind) {
      case 'file':
        return t('docs.fileMissing');
      case 'network':
        return t('docs.errNetwork');
      case 'timeout':
        return t('docs.errTimeout');
      case 'server':
        return `${t('docs.errServer')}${reference}`;
      default:
        return `${error.message || t('docs.uploadFailed')}${reference}`;
    }
  }
  return error instanceof Error && error.message ? error.message : t('docs.uploadFailed');
}

/**
 * Upload or replace one document. The original is sent exactly as captured — official documents
 * are never compressed. The owner (vehicle or driver) is set by the server, and the office
 * verifies it afterwards; the driver never marks their own document as verified.
 *
 * Saving is two steps — the file to storage, then the document record that points at it — and the
 * driver sees "Uploaded" only after both. If the second step fails the file is already stored, so
 * "Try again" re-sends only the record; with the same submission id the server records it once.
 */
export default function UploadDocumentScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const token = useSession((s) => s.token);
  const params = useLocalSearchParams<{ type: string; replace?: string }>();
  const type = TYPES.includes(params.type as DocumentType) ? (params.type as DocumentType) : null;

  const [submissionId] = useState(() => randomUUID());
  const [file, setFile] = useState<LocalReceipt | null>(null);
  /** The stored file's id once step one has succeeded, so a retry does not upload it again. */
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null);
  const [expiryDate, setExpiryDate] = useState<string | null>(null);
  const [documentNumber, setDocumentNumber] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [state, setState] = useState<'idle' | 'uploading' | 'done' | 'failed'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const pick = async (source: () => Promise<CaptureResult>) => {
    const result = await source();
    if (result.status === 'ok') {
      discardReceipt(file?.uri);
      setFile(result.receipt);
      setUploadedFileId(null);
      setMessage(null);
      setState('idle');
    }
  };

  const save = async () => {
    if (!type || !token) return;
    if (!file) return setMessage(t('docs.errFile'));
    setState('uploading');
    setMessage(null);
    setProgress(0);
    try {
      const fileId = uploadedFileId ?? (await uploadDocumentFile(token, file, setProgress));
      setUploadedFileId(fileId);
      await documentsApi.save(token, {
        type,
        fileId,
        ...(expiryDate ? { expiryDate } : {}),
        ...(documentNumber.trim() ? { documentNumber: documentNumber.trim() } : {}),
        clientSubmissionId: submissionId,
      });
      discardReceipt(file.uri);
      setState('done');
    } catch (error) {
      // Everything entered stays on screen, so "Try again" repeats only what is still missing.
      setState('failed');
      setMessage(describeUploadFailure(error, t));
    } finally {
      setProgress(null);
    }
  };

  if (!type) return null;

  if (state === 'done') {
    return (
      <View style={[styles.done, { paddingTop: insets.top + spacing.xxl }]} testID="doc-upload-done">
        <View style={styles.doneIcon}>
          <AppText variant="h1" tone="success">
            ✓
          </AppText>
        </View>
        <AppText variant="h2" style={styles.center}>
          {t('docs.uploaded')}
        </AppText>
        <View style={{ alignSelf: 'stretch', marginTop: spacing.xl }}>
          <PrimaryButton label={t('common.close')} onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  const isPdf = file?.mimeType === 'application/pdf';

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <AppText tone="inverse">‹ {t('common.back')}</AppText>
        </Pressable>
        <AppText variant="h1" tone="inverse">
          {t(`docs.${type}`)}
        </AppText>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]} keyboardShouldPersistTaps="handled">
        {file ? (
          <View style={styles.preview}>
            {isPdf ? (
              <AppText style={styles.pdf}>{`${t('docs.pdf')} · ${file.name}`}</AppText>
            ) : (
              <Image source={{ uri: file.uri }} style={styles.previewImage} resizeMode="contain" accessibilityLabel={t(`docs.${type}`)} />
            )}
          </View>
        ) : null}

        <View style={styles.sources}>
          {[
            { key: 'camera', label: t('docs.takePhoto'), run: () => takePhoto('document') },
            { key: 'gallery', label: t('docs.gallery'), run: () => chooseFromGallery('document') },
            { key: 'file', label: t('docs.chooseFile'), run: () => chooseFile() },
          ].map((source) => (
            <Pressable
              key={source.key}
              accessibilityRole="button"
              testID={`doc-source-${source.key}`}
              disabled={state === 'uploading'}
              onPress={() => void pick(source.run)}
              style={({ pressed }) => [styles.source, pressed && { opacity: 0.85 }]}
            >
              <AppText numberOfLines={2} style={styles.center}>
                {source.label}
              </AppText>
            </Pressable>
          ))}
        </View>

        <Field label={t('docs.expiryDate')} optional>
          <DateField value={expiryDate} onChange={setExpiryDate} maximumToday={false} testID="doc-expiry" />
        </Field>
        <Field label={t('docs.number')} optional>
          <TextField value={documentNumber} onChangeText={setDocumentNumber} autoCapitalize="characters" testID="doc-number" />
        </Field>

        {progress !== null ? (
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
            <View style={styles.track}>
              <View style={[styles.bar, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
            <AppText variant="label" tone="muted" style={{ marginTop: spacing.xs }}>
              {t('docs.uploading', { percent: Math.round(progress * 100) })}
            </AppText>
          </View>
        ) : null}

        {message ? (
          <View style={styles.error} accessibilityLiveRegion="assertive">
            <AppText tone="danger" testID="doc-upload-error">
              {message}
            </AppText>
          </View>
        ) : null}

        <PrimaryButton
          label={state === 'failed' ? t('docs.retry') : t('docs.save')}
          onPress={() => void save()}
          busy={state === 'uploading'}
          testID="doc-save"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.xs },
  back: { minHeight: TOUCH_TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
  body: { padding: spacing.lg, gap: spacing.lg },
  center: { textAlign: 'center' },
  preview: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  previewImage: { width: '100%', height: 220, backgroundColor: colors.muted },
  pdf: { padding: spacing.lg },
  sources: { flexDirection: 'row', gap: spacing.sm },
  source: {
    flex: 1,
    minHeight: TOUCH_TARGET * 1.6,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.muted, overflow: 'hidden' },
  bar: { height: 8, backgroundColor: colors.success },
  error: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.md },
  done: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  doneIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' },
});
