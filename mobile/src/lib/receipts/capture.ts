import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { persistReceipt, type LocalReceipt } from './storage';

export type ReceiptPurpose = 'fuel' | 'document';

/**
 * Fuel receipts are compressed automatically — they are read once for an amount and a date.
 * Every other receipt (RTO, tyre, service, insurance) keeps full quality, because those are
 * official documents and later AI processing reads them. The driver never chooses either way.
 */
const QUALITY: Record<ReceiptPurpose, number> = { fuel: 0.6, document: 1 };

export type CaptureResult = { status: 'ok'; receipt: LocalReceipt } | { status: 'cancelled' } | { status: 'denied' };

async function finish(result: ImagePicker.ImagePickerResult): Promise<CaptureResult> {
  if (result.canceled || !result.assets?.[0]) return { status: 'cancelled' };
  const asset = result.assets[0];
  return { status: 'ok', receipt: await persistReceipt(asset.uri, asset.mimeType ?? 'image/jpeg') };
}

export async function takePhoto(purpose: ReceiptPurpose): Promise<CaptureResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { status: 'denied' };
  return finish(await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: QUALITY[purpose], exif: false }));
}

export async function chooseFromGallery(purpose: ReceiptPurpose): Promise<CaptureResult> {
  return finish(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: QUALITY[purpose], exif: false }));
}

export const qualityFor = (purpose: ReceiptPurpose): number => QUALITY[purpose];

/**
 * Picks a photo or PDF from the phone's files (e.g. an e-insurance policy PDF). The file is kept
 * exactly as it is — official documents are never recompressed.
 */
export async function chooseFile(): Promise<CaptureResult> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.[0]) return { status: 'cancelled' };
  const asset = result.assets[0];
  const receipt = await persistReceipt(asset.uri, asset.mimeType ?? 'application/pdf');
  return { status: 'ok', receipt: { ...receipt, name: asset.name ?? receipt.name } };
}
