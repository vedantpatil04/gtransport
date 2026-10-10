/**
 * The official Driver app (Android APK) offered on the public home page.
 *
 * Every value below was read from the actual release file, not assumed: package, version, size and
 * checksum from the APK itself (aapt2 / SHA-256), and that it is a production build — not debuggable,
 * no dev launcher, API and console addresses baked in as the Render API and this site — from its
 * embedded app config. When a new release is published, update this file together with the file.
 *
 * The file is not stored in this repository (139.7 MB is beyond Vercel's 100 MB deployment limit and
 * GitHub's 100 MB file limit). `vercel.json` sends DOWNLOAD_PATH to wherever the release is hosted, so
 * this address, and every link to it, stays the same when the hosting or the release changes.
 */
export const DRIVER_APP = {
  packageName: 'in.gangamatatransport.driver',
  versionName: '0.1.0',
  versionCode: 1,
  /** Android 7.0 (API 24) and newer, 64- and 32-bit ARM phones. */
  minAndroid: '7.0',
  sizeBytes: 146_532_684,
  sha256: '4def6f4d0b460c1fcc2cae7b0ce518324f587ed087f7194d0b1a366fed794107',
  fileName: 'gangamata-driver-release.apk',
  downloadPath: '/downloads/gangamata-transport.apk',
  releaseUrl: 'https://github.com/vedantpatil04/GangamataTransport/releases/download/driver-v0.1.0/gangamata-driver-release.apk',
} as const;

/** "139.7 MB" — megabytes as phones and file managers count them (1 MB = 1,048,576 bytes). */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
