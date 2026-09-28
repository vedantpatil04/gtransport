import { decideAttachment, extensionOf, normaliseMimeType, sanitiseFilename } from './attachment-policy';

/**
 * Inbound email is untrusted, and an attachment is the part of it most likely to be hostile.
 * These tests pin the refusals — particularly the ones that hold even when the sender lies about
 * the type, which is the whole reason the extension is checked as well.
 */

const MAX = 15 * 1024 * 1024;
const candidate = (over: Partial<Parameters<typeof decideAttachment>[0]> = {}) => ({
  filename: 'invoice.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 120_000,
  ...over,
});

describe('what the office keeps', () => {
  it('keeps a PDF invoice', () => {
    expect(decideAttachment(candidate(), MAX)).toEqual({ keep: true });
  });

  it('keeps a photographed document', () => {
    expect(decideAttachment(candidate({ filename: 'permit.jpg', mimeType: 'image/jpeg' }), MAX)).toEqual({ keep: true });
    expect(decideAttachment(candidate({ filename: 'rc.png', mimeType: 'image/png' }), MAX)).toEqual({ keep: true });
  });

  it('keeps a type declared with a charset parameter', () => {
    expect(decideAttachment(candidate({ mimeType: 'application/pdf; charset=binary' }), MAX)).toEqual({ keep: true });
  });
});

describe('what the office refuses', () => {
  it('refuses an executable', () => {
    expect(decideAttachment(candidate({ filename: 'setup.exe', mimeType: 'application/octet-stream' }), MAX)).toEqual({
      keep: false,
      reason: 'suspicious_extension',
    });
  });

  it('refuses an executable disguised as a PDF', () => {
    // The declared type is the sender's assertion, and a hostile sender will simply lie. This is
    // the case the extension check exists for.
    expect(decideAttachment(candidate({ filename: 'invoice.pdf.exe', mimeType: 'application/pdf' }), MAX)).toEqual({
      keep: false,
      reason: 'suspicious_extension',
    });
  });

  it('refuses a macro-bearing office document', () => {
    expect(decideAttachment(candidate({ filename: 'quote.xlsm', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12' }), MAX)).toEqual({
      keep: false,
      reason: 'suspicious_extension',
    });
  });

  it('refuses a script, whatever it claims to be', () => {
    for (const filename of ['run.js', 'payload.vbs', 'setup.ps1', 'install.sh']) {
      expect(decideAttachment(candidate({ filename, mimeType: 'application/pdf' }), MAX).keep).toBe(false);
    }
  });

  it('refuses an unsupported but harmless type, so nothing unexpected is stored', () => {
    expect(decideAttachment(candidate({ filename: 'notes.txt', mimeType: 'text/plain' }), MAX)).toEqual({
      keep: false,
      reason: 'unsupported_type',
    });
  });

  it('refuses something larger than the limit', () => {
    expect(decideAttachment(candidate({ sizeBytes: MAX + 1 }), MAX)).toEqual({ keep: false, reason: 'too_large' });
  });

  it('refuses an empty part', () => {
    expect(decideAttachment(candidate({ sizeBytes: 0 }), MAX)).toEqual({ keep: false, reason: 'empty' });
  });

  it('always gives a reason, so a refusal is visible rather than silent', () => {
    const decision = decideAttachment(candidate({ filename: 'x.exe' }), MAX);
    expect(decision.keep).toBe(false);
    if (!decision.keep) expect(decision.reason).toBeTruthy();
  });
});

describe('sanitiseFilename', () => {
  it('strips path separators, so a filename cannot influence where a file lands', () => {
    expect(sanitiseFilename('../../etc/passwd')).not.toContain('/');
    expect(sanitiseFilename('..\\..\\windows\\system32')).not.toContain('\\');
  });

  it('collapses traversal sequences', () => {
    expect(sanitiseFilename('invoice...pdf')).toBe('invoice.pdf');
  });

  it('removes control characters', () => {
    expect(sanitiseFilename('invoice\u0000\u001b.pdf')).toBe('invoice.pdf');
  });

  it('falls back when nothing usable is left', () => {
    expect(sanitiseFilename('   ', 'attachment-1')).toBe('attachment-1');
  });

  it('keeps an ordinary name intact', () => {
    expect(sanitiseFilename('Invoice INV-2291.pdf')).toBe('Invoice INV-2291.pdf');
  });

  it('bounds the length', () => {
    expect(sanitiseFilename('a'.repeat(500)).length).toBeLessThanOrEqual(180);
  });
});

describe('helpers', () => {
  it('reads the extension', () => {
    expect(extensionOf('invoice.PDF')).toBe('pdf');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
    expect(extensionOf('noextension')).toBeNull();
  });

  it('strips MIME parameters', () => {
    expect(normaliseMimeType('Application/PDF; charset=binary')).toBe('application/pdf');
    expect(normaliseMimeType('image/jpeg')).toBe('image/jpeg');
  });
});
