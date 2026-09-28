/**
 * What arrives on an email, and what is worth keeping.
 *
 * Inbound mail is untrusted (§24). This module decides — before a single byte is downloaded or
 * stored — whether an attachment is something the office would want in its files, and refuses
 * everything else with a recorded reason rather than silently dropping it.
 *
 * Nothing here opens, parses or executes an attachment. The decision is made on the metadata the
 * provider reported, which is the only safe thing to look at.
 */

/** Documents a transport office actually receives: invoices, policies, permits, photographs. */
export const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/tiff',
]);

/**
 * Extensions refused regardless of what the sender claimed the type was.
 *
 * A declared MIME type is the sender's assertion, and a hostile one will simply lie. Checking the
 * extension as well means a `.exe` announced as `application/pdf` is still refused — this is
 * belt and braces on purpose, because the cost of being wrong is someone opening it.
 */
export const BLOCKED_EXTENSIONS = new Set([
  'exe', 'com', 'bat', 'cmd', 'msi', 'scr', 'pif', 'cpl', 'jar', 'app', 'dmg',
  'js', 'jse', 'vbs', 'vbe', 'wsf', 'wsh', 'ps1', 'psm1', 'sh', 'bash',
  'dll', 'sys', 'drv', 'lnk', 'reg', 'hta', 'chm', 'iso', 'img',
  // Office formats that can carry macros. The office receives PDFs; these are not worth the risk.
  'docm', 'xlsm', 'pptm', 'dotm', 'xltm',
]);

export type AttachmentDecision =
  | { keep: true }
  | { keep: false; reason: 'unsupported_type' | 'too_large' | 'suspicious_extension' | 'empty' };

export interface AttachmentCandidate {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export function decideAttachment(candidate: AttachmentCandidate, maxBytes: number): AttachmentDecision {
  const extension = extensionOf(candidate.filename);

  // Extension first: a dangerous one is refused whatever it claims to be.
  if (extension && BLOCKED_EXTENSIONS.has(extension)) return { keep: false, reason: 'suspicious_extension' };

  // A double extension ("invoice.pdf.exe") is a deliberate disguise, and the check above already
  // catches it — but a name ending in a blocked extension anywhere is worth refusing outright.
  const parts = candidate.filename.toLowerCase().split('.').slice(1);
  if (parts.some((part) => BLOCKED_EXTENSIONS.has(part))) return { keep: false, reason: 'suspicious_extension' };

  if (candidate.sizeBytes <= 0) return { keep: false, reason: 'empty' };
  if (candidate.sizeBytes > maxBytes) return { keep: false, reason: 'too_large' };
  if (!ALLOWED_ATTACHMENT_TYPES.has(normaliseMimeType(candidate.mimeType))) return { keep: false, reason: 'unsupported_type' };

  return { keep: true };
}

/** `application/pdf; charset=binary` → `application/pdf`. */
export function normaliseMimeType(value: string): string {
  return value.split(';')[0]!.trim().toLowerCase();
}

export function extensionOf(filename: string): string | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * A filename safe to store and to show.
 *
 * Path separators and traversal sequences are removed because a filename from an email is
 * attacker-controlled text, and it must never be able to influence where a file lands.
 */
export function sanitiseFilename(filename: string, fallback = 'attachment'): string {
  const cleaned = filename
    .replace(/[\\/]/g, '_')
    .replace(/\.{2,}/g, '.')
    // Control characters are exactly what is being removed here, so the rule warning against
    // matching them is the wrong way round in this one place.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 180);
  return cleaned || fallback;
}
