import { ApiError, setUnauthorizedHandler } from '../api/client';
import { uploadDocumentFile } from '../api/documents';
import { uploadReceipt } from '../api/operations';
import { normaliseMimeType, uploadFile } from '../api/upload';
import { assertLocalFileExists } from '../receipts/storage';
import { FakeXhr } from './helpers/fake-xhr';

const files = () => (jest.requireMock('expo-file-system') as { __files: Set<string> }).__files;
const photo = { uri: 'file:///cache/ImagePicker/rc.png', mimeType: 'image/png', name: 'rc.png' };
const noWait = () => Promise.resolve();

/**
 * Root cause of "Could not upload right now." in the driver app: in Expo SDK 57 the global fetch is
 * expo/fetch, which rejects React Native's { uri, name, type } file part ("Unsupported FormDataPart
 * implementation") before sending anything. Uploads therefore go through XMLHttpRequest. These tests
 * pin that: fetch must never be the transport for a file.
 */
describe('file uploads', () => {
  let fetchSpy: jest.Mock;

  beforeEach(() => {
    FakeXhr.install();
    FakeXhr.reset();
    files().clear();
    files().add(photo.uri);
    fetchSpy = jest.fn(() => {
      throw new Error('fetch must not be used for multipart uploads: expo/fetch cannot send { uri } file parts');
    });
    (global as unknown as { fetch: jest.Mock }).fetch = fetchSpy;
    setUnauthorizedHandler(null);
  });

  it('sends the photo as a multipart file part over XMLHttpRequest — never fetch — with the session token', async () => {
    FakeXhr.reset([{ status: 201, body: { fileId: 'file-1' } }]);

    await expect(uploadFile({ path: '/files/documents', token: 'tok', file: photo })).resolves.toBe('file-1');

    expect(fetchSpy).not.toHaveBeenCalled();
    const [request] = FakeXhr.requests;
    expect(request).toMatchObject({ method: 'POST', url: 'https://api.test.gangamata/api/v1/files/documents' });
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer tok', Accept: 'application/json' });
    expect(request?.form._parts).toEqual([['file', { uri: photo.uri, name: 'rc.png', type: 'image/png' }]]);
  });

  it('reports real progress, and 1 only once the server has confirmed the file', async () => {
    FakeXhr.reset([{ status: 201, body: { fileId: 'file-1' } }]);
    const seen: number[] = [];
    await uploadFile({ path: '/files/receipts', token: 't', file: photo, onProgress: (p) => seen.push(p) });

    expect(seen).toEqual([0.2, 0.95, 1]);
  });

  it('normalises the legacy JPEG aliases some Android pickers report', () => {
    expect(normaliseMimeType('image/jpg')).toBe('image/jpeg');
    expect(normaliseMimeType('IMAGE/PJPEG; charset=x')).toBe('image/jpeg');
    expect(normaliseMimeType(undefined)).toBe('image/jpeg');
    expect(normaliseMimeType('application/pdf')).toBe('application/pdf');
  });

  it('uploadDocumentFile and uploadReceipt use the right endpoints', async () => {
    FakeXhr.reset([
      { status: 201, body: { fileId: 'd' } },
      { status: 201, body: { fileId: 'r' } },
    ]);
    await uploadDocumentFile('t', photo, () => undefined);
    await uploadReceipt('t', photo);
    expect(FakeXhr.requests.map((r) => r.url.split('/api/v1')[1])).toEqual(['/files/documents', '/files/receipts']);
  });

  describe('failures', () => {
    it('keeps the server wording and request reference for a refusal, and does not retry it', async () => {
      FakeXhr.reset([
        { status: 400, body: { error: { message: 'Receipts must be a photo (JPEG, PNG, WebP, HEIC) or a PDF.', code: 'BAD_REQUEST', requestId: 'req-9' } } },
      ]);
      const error = (await uploadFile({ path: '/files/documents', token: 't', file: photo, sleep: noWait }).catch((e: unknown) => e)) as ApiError;

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ kind: 'validation', status: 400, requestId: 'req-9', message: 'Receipts must be a photo (JPEG, PNG, WebP, HEIC) or a PDF.' });
      expect(FakeXhr.requests).toHaveLength(1);
    });

    it('treats a too-large file as a refusal, not something to retry', async () => {
      FakeXhr.reset([{ status: 413, body: { error: { message: 'The receipt is larger than 15 MB.' } } }]);
      await expect(uploadFile({ path: '/files/documents', token: 't', file: photo, sleep: noWait })).rejects.toMatchObject({ kind: 'validation', status: 413 });
      expect(FakeXhr.requests).toHaveLength(1);
    });

    it('ends the session once, centrally, when the server rejects it', async () => {
      const onUnauthorized = jest.fn();
      setUnauthorizedHandler(onUnauthorized);
      FakeXhr.reset([{ status: 401, body: { error: { message: 'Session expired' } } }]);

      await expect(uploadFile({ path: '/files/documents', token: 't', file: photo, sleep: noWait })).rejects.toMatchObject({ kind: 'unauthorized' });
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      expect(FakeXhr.requests).toHaveLength(1);
    });

    it('retries a dropped connection and succeeds when the link recovers', async () => {
      FakeXhr.reset([{ error: 'network' }, { status: 503, body: { error: { message: 'waking up' } } }, { status: 201, body: { fileId: 'file-2' } }]);
      const sleep = jest.fn(noWait);

      await expect(uploadFile({ path: '/files/documents', token: 't', file: photo, sleep })).resolves.toBe('file-2');
      expect(FakeXhr.requests).toHaveLength(3);
      expect(sleep.mock.calls.map((call) => (call as unknown as [number])[0])).toEqual([1500, 3000]);
    });

    it('gives up after a bounded number of attempts and reports what happened', async () => {
      FakeXhr.reset([{ error: 'timeout' }, { error: 'timeout' }, { error: 'timeout' }, { error: 'timeout' }]);
      await expect(uploadFile({ path: '/files/documents', token: 't', file: photo, sleep: noWait })).rejects.toMatchObject({ kind: 'timeout' });
      expect(FakeXhr.requests).toHaveLength(3);
    });

    it('treats an HTML error page from the hosting proxy as a server failure, not a crash', async () => {
      FakeXhr.reset([
        { status: 502, rawBody: '<html>Bad gateway</html>' },
        { status: 502, rawBody: '<html>Bad gateway</html>' },
        { status: 502, rawBody: '<html>Bad gateway</html>' },
      ]);
      await expect(uploadFile({ path: '/files/documents', token: 't', file: photo, sleep: noWait })).rejects.toMatchObject({ kind: 'server', status: 502 });
    });

    it('does not report success when the server answers 2xx without a file id', async () => {
      FakeXhr.reset([
        { status: 201, body: {} },
        { status: 201, body: {} },
        { status: 201, body: {} },
      ]);
      await expect(uploadFile({ path: '/files/documents', token: 't', file: photo, sleep: noWait })).rejects.toMatchObject({ kind: 'server' });
    });
  });

  describe('a photo that is no longer on the phone', () => {
    it('is reported as such before any request is made — not as a connection problem', async () => {
      files().clear();
      const error = (await uploadDocumentFile('t', photo, () => undefined).catch((e: unknown) => e)) as ApiError;

      expect(error).toMatchObject({ kind: 'file' });
      expect(error.retryable).toBe(false);
      expect(FakeXhr.requests).toHaveLength(0);
    });

    it('cannot block a file it has no way to check (content:// URIs)', () => {
      expect(() => assertLocalFileExists('content://media/external/images/12')).not.toThrow();
    });
  });
});
