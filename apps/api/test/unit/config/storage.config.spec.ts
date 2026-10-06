import { ConfigService } from '@nestjs/config';

import { StorageConfigService, validateStorageEnvironment } from '@config/storage.config';

const ENVIRONMENT = {
  SUPABASE_URL: 'https://storage.example.test',
  SUPABASE_SECRET_KEY: 'sb_secret_unit_test',
  SUPABASE_AVATAR_BUCKET: 'test-avatars',
  SUPABASE_DOCUMENT_BUCKET: 'test-documents',
};

describe('Storage configuration', () => {
  it('validates and resolves server-only storage values', () => {
    expect(validateStorageEnvironment(ENVIRONMENT)).toBe(ENVIRONMENT);
    expect(new StorageConfigService(new ConfigService(ENVIRONMENT)).values).toEqual({
      url: ENVIRONMENT.SUPABASE_URL,
      secretKey: ENVIRONMENT.SUPABASE_SECRET_KEY,
      avatarBucket: ENVIRONMENT.SUPABASE_AVATAR_BUCKET,
      documentBucket: ENVIRONMENT.SUPABASE_DOCUMENT_BUCKET,
    });
  });

  it.each(Object.keys(ENVIRONMENT))('requires %s even in tests', (key) => {
    for (const value of [undefined, '', ' ', '[REPLACE_ME]']) {
      expect(() =>
        validateStorageEnvironment({ ...ENVIRONMENT, NODE_ENV: 'test', [key]: value }),
      ).toThrow(key);
    }
  });

  it.each([
    'not-a-url',
    'https://[PROJECT_REF].supabase.co',
    'http://remote.example.test',
    'ftp://remote.example.test',
    'https://user:secret@storage.example.test',
    'https://storage.example.test/path',
    'https://storage.example.test?token=secret',
    'https://storage.example.test#fragment',
  ])('rejects an unsafe project URL: %s', (url) => {
    expect(() => validateStorageEnvironment({ ...ENVIRONMENT, SUPABASE_URL: url })).toThrow(
      'SUPABASE_URL',
    );
  });

  it.each(['http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321'])(
    'supports local Supabase at %s',
    (url) => {
      expect(validateStorageEnvironment({ ...ENVIRONMENT, SUPABASE_URL: url })).toBeDefined();
    },
  );

  it.each(['sb_publishable_secret', 'eyJlegacy-token', 'sb_secret_', 'sb_secret_[REPLACE_ME]'])(
    'rejects a non-secret or placeholder API key',
    (secretKey) => {
      try {
        validateStorageEnvironment({ ...ENVIRONMENT, SUPABASE_SECRET_KEY: secretKey });
        throw new Error('Expected validation to fail');
      } catch (error) {
        expect(String(error)).toContain('SUPABASE_SECRET_KEY');
        expect(String(error)).not.toContain(secretKey);
      }
    },
  );

  it.each(['../documents', 'documents/images', 'https://bucket.example.test', 'A'.repeat(64)])(
    'rejects invalid bucket names',
    (bucket) => {
      expect(() =>
        validateStorageEnvironment({ ...ENVIRONMENT, SUPABASE_DOCUMENT_BUCKET: bucket }),
      ).toThrow('SUPABASE_DOCUMENT_BUCKET');
    },
  );

  it('prevents documents and avatars sharing a bucket', () => {
    expect(() =>
      validateStorageEnvironment({
        ...ENVIRONMENT,
        SUPABASE_DOCUMENT_BUCKET: ENVIRONMENT.SUPABASE_AVATAR_BUCKET,
      }),
    ).toThrow('Avatar and document buckets must be different');
  });
});
