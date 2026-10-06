import {
  BadRequestException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createClient } from '@supabase/supabase-js';

import { StorageConfigService } from '@config/storage.config';
import { StorageRequestError } from '@infrastructure/storage/storage-request-error';
import { StorageModule } from '@infrastructure/storage/storage.module';
import { StorageService } from '@infrastructure/storage/storage.service';
import {
  AVATAR_MAX_SIZE_BYTES,
  DOCUMENT_MAX_SIZE_BYTES,
  STORAGE_CLIENT,
} from '@infrastructure/storage/storage.types';

import type { StoragePurpose } from '@infrastructure/storage/storage.types';

const OWNER_ID = '46f93a9a-725c-45bf-b31f-b2c2c4bb97ef';
const OBJECT_PATH = `${OWNER_ID}/f9316ca5-c587-47a4-9b75-3492f2a26fe4.png`;
const ENVIRONMENT = {
  SUPABASE_URL: 'https://storage.example.test',
  SUPABASE_SECRET_KEY: 'sb_secret_unit_test',
  SUPABASE_AVATAR_BUCKET: 'test-avatars',
  SUPABASE_DOCUMENT_BUCKET: 'test-documents',
};
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZi8AAAAASUVORK5CYII=',
  'base64',
);
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
const WEBP = Buffer.from('524946461400000057454250565038200000000000000000', 'hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('StorageService', () => {
  const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();
  const config = new StorageConfigService(new ConfigService(ENVIRONMENT));
  const client = createClient<Record<string, never>>(config.values.url, config.values.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: fetchMock },
  });
  const service = new StorageService(config, client);

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('requires the avatar bucket to be private for the avatar feature', async () => {
    fetchMock.mockResolvedValueOnce(response({ id: 'test-avatars', public: false }));
    await expect(service.assertPrivateAvatarBucket()).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(response({ id: 'test-avatars', public: true }));
    await expect(service.assertPrivateAvatarBucket()).rejects.toThrow(
      'Avatar storage must use a private bucket',
    );
    fetchMock.mockRejectedValueOnce(new Error('provider secret details'));
    await expect(service.assertPrivateAvatarBucket()).rejects.toThrow(
      'Avatar bucket could not be checked',
    );
  });

  it('can be injected by a feature importing StorageModule', async () => {
    const module = await Test.createTestingModule({
      imports: [StorageModule],
      providers: [{ provide: ConfigService, useValue: new ConfigService(ENVIRONMENT) }],
    })
      .overrideProvider(StorageConfigService)
      .useValue(config)
      .overrideProvider(STORAGE_CLIENT)
      .useValue(client)
      .compile();
    expect(module.get(StorageService)).toBeInstanceOf(StorageService);
    await module.close();
  });

  it.each([
    { buffer: PNG, mimeType: 'image/png', extension: 'png' },
    { buffer: JPEG, mimeType: 'image/jpeg', extension: 'jpg' },
    { buffer: WEBP, mimeType: 'image/webp', extension: 'webp' },
  ])('uploads $mimeType avatars with generated paths and no overwrite', async (file) => {
    fetchMock.mockResolvedValue(response({ Key: 'uploaded', Id: 'file-id' }));
    const stored = await service.uploadAvatar(OWNER_ID, file);

    expect(stored.objectPath).toMatch(new RegExp(`^${OWNER_ID}/[a-f0-9-]+\\.${file.extension}$`));
    expect(stored).toEqual({
      objectPath: stored.objectPath,
      mimeType: file.mimeType,
      sizeBytes: file.buffer.length,
    });
    const call = fetchMock.mock.calls[0];
    if (!call) {
      throw new Error('Expected an upload request');
    }
    const request = new Request(...call);
    expect(request.url).toBe(
      `${ENVIRONMENT.SUPABASE_URL}/storage/v1/object/test-avatars/${stored.objectPath}`,
    );
    expect(request.headers.get('content-type')).toBe(file.mimeType);
    expect(request.headers.get('x-upsert')).toBe('false');
    expect(request.headers.get('cache-control')).toBe('max-age=3600');
    expect(Buffer.from(await request.arrayBuffer())).toEqual(file.buffer);
    expect(stored).not.toHaveProperty('publicUrl');
    expect(stored).not.toHaveProperty('signedUrl');
  });

  it.each([
    { buffer: PDF, mimeType: 'application/pdf' },
    { buffer: PNG, mimeType: 'image/png' },
    { buffer: JPEG, mimeType: 'image/jpeg' },
  ])('uploads $mimeType documents only after checking bucket privacy', async (file) => {
    fetchMock
      .mockResolvedValueOnce(response({ id: 'test-documents', public: false }))
      .mockResolvedValueOnce(response({ Key: 'uploaded', Id: 'file-id' }));
    const stored = await service.uploadDocument(OWNER_ID, file);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${ENVIRONMENT.SUPABASE_URL}/storage/v1/bucket/test-documents`,
    );
    const call = fetchMock.mock.calls[1];
    if (!call) {
      throw new Error('Expected an upload request');
    }
    const request = new Request(...call);
    expect(request.url).toContain(`/object/test-documents/${stored.objectPath}`);
    expect(request.headers.get('cache-control')).toBe('max-age=0');
    expect(stored.sizeBytes).toBe(file.buffer.length);
  });

  it('uses a fresh path for every upload', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(response({ Key: 'uploaded', Id: 'file-id' })),
    );
    const first = await service.uploadAvatar(OWNER_ID, { buffer: PNG, mimeType: 'image/png' });
    const second = await service.uploadAvatar(OWNER_ID, { buffer: PNG, mimeType: 'image/png' });
    expect(first.objectPath).not.toBe(second.objectPath);
  });

  it('prepares a path before network I/O and uploads exactly that path', async () => {
    const prepared = service.prepareDocument(OWNER_ID, {
      buffer: PDF,
      mimeType: 'application/pdf',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock
      .mockResolvedValueOnce(response({ public: false }))
      .mockResolvedValueOnce(response({ Key: 'uploaded', Id: 'file-id' }));
    const stored = await service.uploadPrepared(prepared);
    expect(stored.objectPath).toBe(prepared.objectPath);
    expect(fetchMock.mock.calls[1]?.[0]).toContain(prepared.objectPath);
  });

  it('rejects tampered prepared upload metadata before network I/O', async () => {
    const prepared = service.prepareDocument(OWNER_ID, {
      buffer: PDF,
      mimeType: 'application/pdf',
    });
    await expect(service.uploadPrepared({ ...prepared, sizeBytes: 0 })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.uploadPrepared({ ...prepared, objectPath: `${OWNER_ID}/file.png` }),
    ).rejects.toThrow(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { buffer: Buffer.alloc(0), mimeType: 'image/png' },
    { buffer: PDF, mimeType: 'image/png' },
    { buffer: Buffer.from('<svg></svg>'), mimeType: 'image/svg+xml' },
    { buffer: Buffer.from('fake image'), mimeType: 'image/png' },
    { buffer: PNG, mimeType: 'application/octet-stream' },
  ])('rejects empty, unsupported and spoofed avatar files before storage', async (file) => {
    await expect(service.uploadAvatar(OWNER_ID, file)).rejects.toThrow(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects WebP documents and invalid owner IDs before storage', async () => {
    await expect(
      service.uploadDocument(OWNER_ID, { buffer: WEBP, mimeType: 'image/webp' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.uploadAvatar('../another-user', { buffer: PNG, mimeType: 'image/png' }),
    ).rejects.toThrow(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { purpose: 'avatar', size: AVATAR_MAX_SIZE_BYTES },
    { purpose: 'document', size: DOCUMENT_MAX_SIZE_BYTES },
  ] satisfies Array<{ purpose: StoragePurpose; size: number }>)(
    'enforces the actual buffer size for $purpose',
    async ({ purpose, size }) => {
      const file = { buffer: Buffer.alloc(size + 1), mimeType: 'image/png' };
      const upload =
        purpose === 'avatar'
          ? service.uploadAvatar(OWNER_ID, file)
          : service.uploadDocument(OWNER_ID, file);
      await expect(upload).rejects.toThrow(PayloadTooLargeException);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('refuses document uploads and signed URLs when the bucket is public', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(response({ id: 'test-documents', public: true })),
    );
    await expect(
      service.uploadDocument(OWNER_ID, { buffer: PDF, mimeType: 'application/pdf' }),
    ).rejects.toThrow('Document storage must use a private bucket');
    await expect(service.createSignedUrl('document', OBJECT_PATH)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns avatar public URLs without exposing the API key', () => {
    expect(service.getAvatarPublicUrl(OBJECT_PATH)).toBe(
      `${ENVIRONMENT.SUPABASE_URL}/storage/v1/object/public/test-avatars/${OBJECT_PATH}`,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses document storage when the provider omits the privacy flag', async () => {
    fetchMock.mockResolvedValue(response({ id: 'test-documents' }));
    await expect(
      service.uploadDocument(OWNER_ID, { buffer: PDF, mimeType: 'application/pdf' }),
    ).rejects.toThrow('Document storage must use a private bucket');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('creates transient document URLs with a five-minute default', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ id: 'test-documents', public: false }))
      .mockResolvedValueOnce(
        response({ signedURL: '/object/sign/test-documents/file?token=test' }),
      );
    await expect(service.createSignedUrl('document', OBJECT_PATH)).resolves.toBe(
      `${ENVIRONMENT.SUPABASE_URL}/storage/v1/object/sign/test-documents/file?token=test`,
    );
    const call = fetchMock.mock.calls[1];
    if (!call) {
      throw new Error('Expected a signing request');
    }
    expect(await new Request(...call).json()).toEqual({ expiresIn: 300 });
  });

  it('supports signed URLs for private avatars', async () => {
    fetchMock.mockResolvedValue(
      response({ signedURL: '/object/sign/test-avatars/file?token=test' }),
    );
    await service.createSignedUrl('avatar', OBJECT_PATH, 60);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 301, 1.5, NaN, Infinity])('rejects unsafe signed URL lifetimes', async (ttl) => {
    await expect(service.createSignedUrl('document', OBJECT_PATH, ttl)).rejects.toThrow(
      BadRequestException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    '../file.png',
    '/file.png',
    'a/../file.png',
    'a//file.png',
    'a/./file.png',
    'https://storage.example.test/file',
    'a/%2e%2e/file',
    'a/file?token=secret',
    'a\\file',
    '',
  ])('rejects unsafe object paths', async (objectPath) => {
    expect(() => service.getAvatarPublicUrl(objectPath)).toThrow(BadRequestException);
    await expect(service.remove('document', objectPath)).rejects.toThrow(BadRequestException);
    await expect(service.createSignedUrl('document', objectPath)).rejects.toThrow(
      BadRequestException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deletes only the specified file from the selected bucket', async () => {
    fetchMock.mockResolvedValue(response([]));
    await service.remove('document', OBJECT_PATH);
    const call = fetchMock.mock.calls[0];
    if (!call) {
      throw new Error('Expected a delete request');
    }
    const request = new Request(...call);
    expect(request.method).toBe('DELETE');
    expect(request.url).toBe(`${ENVIRONMENT.SUPABASE_URL}/storage/v1/object/test-documents`);
    expect(await request.json()).toEqual({ prefixes: [OBJECT_PATH] });
  });

  it('maps upstream errors without leaking provider messages or secrets', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        response(
          { message: 'sb_secret_private_value /private-document/path', statusCode: '403' },
          403,
        ),
      ),
    );
    await expect(
      service.uploadAvatar(OWNER_ID, { buffer: PNG, mimeType: 'image/png' }),
    ).rejects.toThrow(new ServiceUnavailableException('File could not be uploaded'));
    await expect(service.remove('avatar', OBJECT_PATH)).rejects.toThrow(
      new ServiceUnavailableException('Stored file could not be deleted'),
    );
    await expect(service.createSignedUrl('document', OBJECT_PATH)).rejects.toThrow(
      new ServiceUnavailableException('Document bucket could not be checked'),
    );
    await expect(service.createSignedUrl('avatar', OBJECT_PATH)).rejects.toThrow(
      new ServiceUnavailableException('Stored file URL could not be created'),
    );
  });

  it('maps unexpected network exceptions to a stable service error', async () => {
    fetchMock.mockRejectedValue(new Error('private-network-details'));
    await expect(service.remove('document', OBJECT_PATH)).rejects.toThrow(
      new ServiceUnavailableException('Stored file could not be deleted'),
    );
  });

  it.each([
    { error: { status: 403, code: 'private-value' }, expectedCode: 'STORAGE_HTTP_403' },
    { error: { status: 404 }, expectedCode: 'STORAGE_HTTP_404' },
    { error: { status: 503 }, expectedCode: 'STORAGE_HTTP_503' },
    { error: { name: 'TimeoutError' }, expectedCode: 'STORAGE_TIMEOUT' },
    { error: { name: 'AbortError' }, expectedCode: 'STORAGE_ABORTED' },
    { error: { cause: { code: 'ECONNRESET' } }, expectedCode: 'ECONNRESET' },
    { error: { cause: { code: 'ENOTFOUND' } }, expectedCode: 'ENOTFOUND' },
    { error: { code: 'sb_secret_private' }, expectedCode: 'STORAGE_REQUEST_FAILED' },
    { error: { status: 'sb_secret_private' }, expectedCode: 'STORAGE_REQUEST_FAILED' },
    { error: { status: 403.5 }, expectedCode: 'STORAGE_REQUEST_FAILED' },
  ])(
    'keeps only $expectedCode for diagnostics without changing the HTTP response',
    async ({ error, expectedCode }) => {
      fetchMock.mockRejectedValue(
        Object.assign(new Error('sb_secret_private /private/path?token=private'), error),
      );
      try {
        await service.remove('document', OBJECT_PATH);
        throw new Error('Expected deletion to fail');
      } catch (failure) {
        expect(failure).toBeInstanceOf(StorageRequestError);
        if (!(failure instanceof StorageRequestError)) {
          throw failure;
        }
        expect(failure.failureCode).toBe(expectedCode);
        expect(failure.getResponse()).toEqual({
          message: 'Stored file could not be deleted',
          error: 'Service Unavailable',
          statusCode: 503,
        });
        expect(JSON.stringify(failure)).not.toContain('sb_secret_private');
        expect(JSON.stringify(failure)).not.toContain('token=private');
        expect(JSON.stringify(failure)).not.toContain('/private/path');
      }
    },
  );

  it('preserves the real SDK provider status for recovery diagnostics', async () => {
    fetchMock.mockResolvedValue(response({ message: 'private-value', statusCode: '403' }, 403));
    await expect(service.remove('document', OBJECT_PATH)).rejects.toMatchObject({
      failureCode: 'STORAGE_HTTP_403',
    });
  });
});
