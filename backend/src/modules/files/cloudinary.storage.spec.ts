import { CloudinaryFileStorage } from './cloudinary.storage';
import { v2 as cloudinary } from 'cloudinary';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    url: jest.fn((key: string) => `https://res.cloudinary.com/test-cloud/image/upload/v1/${key}`),
    uploader: {
      upload_stream: jest.fn((options, callback) => {
        const stream = {
          end: jest.fn((buffer: Buffer) => {
            callback(null, {
              public_id: options.public_id,
              secure_url: `https://res.cloudinary.com/test-cloud/image/upload/v1/${options.public_id}`,
              bytes: buffer.byteLength,
              format: 'jpg',
              resource_type: options.resource_type || 'image',
            });
          }),
        };
        return stream;
      }),
    },
    api: {
      resource: jest.fn(async (key: string) => ({ public_id: key })),
    },
  },
}));

describe('CloudinaryFileStorage', () => {
  const validConfig = {
    cloudName: 'test-cloud',
    apiKey: '123456789012345',
    apiSecret: 'test-secret',
    folder: 'gangamata',
  };

  it('reports isConfigured accurately', () => {
    const unconfigured = new CloudinaryFileStorage({ cloudName: '', apiKey: '', apiSecret: '' });
    expect(unconfigured.isConfigured).toBe(false);

    const placeholder = new CloudinaryFileStorage({
      cloudName: 'placeholder_cloud',
      apiKey: 'placeholder_key',
      apiSecret: 'secret',
    });
    expect(placeholder.isConfigured).toBe(false);

    const configured = new CloudinaryFileStorage(validConfig);
    expect(configured.isConfigured).toBe(true);
    expect(configured.provider).toBe('CLOUDINARY');
  });

  it('refuses put when credentials are not configured (no fake success)', async () => {
    const unconfigured = new CloudinaryFileStorage({ cloudName: '', apiKey: '', apiSecret: '' });
    await expect(
      unconfigured.put({
        key: 'companies/c1/receipts/2026/10/file.jpg',
        body: new Uint8Array([1, 2, 3]),
        contentType: 'image/jpeg',
      }),
    ).rejects.toThrow(/Cloudinary credentials are not configured/);
  });

  it('uploads an image receipt with automatic optimization and returns public ID and secure URL', async () => {
    const storage = new CloudinaryFileStorage(validConfig);
    const body = new TextEncoder().encode('fake-image-bytes');

    const result = await storage.put({
      key: 'companies/c1/receipts/2026/10/receipt-uuid.jpg',
      body,
      contentType: 'image/jpeg',
    });

    expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(
      expect.objectContaining({
        public_id: 'gangamata/companies/c1/receipts/2026/10/receipt-uuid',
        resource_type: 'image',
        quality: 'auto:good',
        fetch_format: 'auto',
      }),
      expect.any(Function),
    );

    expect(result.key).toBe('gangamata/companies/c1/receipts/2026/10/receipt-uuid');
    expect(result.bucket).toMatch(/^https:\/\/res\.cloudinary\.com/);
    expect(result.sizeBytes).toBe(body.byteLength);
    expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uploads a PDF document as raw resource without image compression', async () => {
    const storage = new CloudinaryFileStorage(validConfig);
    const body = new TextEncoder().encode('%PDF-1.4 fake pdf');

    const result = await storage.put({
      key: 'companies/c1/docs/2026/10/doc-uuid.pdf',
      body,
      contentType: 'application/pdf',
    });

    expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(
      expect.objectContaining({
        public_id: 'gangamata/companies/c1/docs/2026/10/doc-uuid.pdf',
        resource_type: 'raw',
      }),
      expect.any(Function),
    );

    expect(result.key).toBe('gangamata/companies/c1/docs/2026/10/doc-uuid.pdf');
  });

  it('uploads an official document image preserving original quality without recompression', async () => {
    const storage = new CloudinaryFileStorage(validConfig);
    const body = new TextEncoder().encode('fake-rc-image-bytes');

    const result = await storage.put({
      key: 'companies/c1/documents/2026/10/rc-uuid.jpg',
      body,
      contentType: 'image/jpeg',
    });

    expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(
      expect.objectContaining({
        public_id: 'gangamata/companies/c1/documents/2026/10/rc-uuid',
        resource_type: 'image',
      }),
      expect.any(Function),
    );
    // Preserves original document without quality: 'auto:good' or fetch_format: 'auto'
    const callArgs = (cloudinary.uploader.upload_stream as jest.Mock).mock.calls.slice(-1)[0][0];
    expect(callArgs.quality).toBeUndefined();
    expect(callArgs.fetch_format).toBeUndefined();

    expect(result.key).toBe('gangamata/companies/c1/documents/2026/10/rc-uuid');
    expect(result.bucket).toMatch(/^https:\/\/res\.cloudinary\.com/);
  });

  it('rejects unsafe keys', async () => {
    const storage = new CloudinaryFileStorage(validConfig);
    await expect(
      storage.put({
        key: '../unsafe.jpg',
        body: new Uint8Array([1]),
        contentType: 'image/jpeg',
      }),
    ).rejects.toThrow();
  });

  it('generates secure download URLs', async () => {
    const storage = new CloudinaryFileStorage(validConfig);
    const url = await storage.createTemporaryDownloadUrl('gangamata/test-key');
    expect(url).toContain('https://res.cloudinary.com/test-cloud/');
  });

  it('reports existence based on Cloudinary API', async () => {
    const storage = new CloudinaryFileStorage(validConfig);
    await expect(storage.exists('gangamata/test-key')).resolves.toBe(true);

    (cloudinary.api.resource as jest.Mock).mockRejectedValueOnce(new Error('Not found'));
    await expect(storage.exists('gangamata/missing-key')).resolves.toBe(false);
  });
});
