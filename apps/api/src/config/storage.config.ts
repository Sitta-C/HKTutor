import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface StorageConfiguration {
  url: string;
  secretKey: string;
  avatarBucket: string;
  documentBucket: string;
}

function required(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value !== 'string' || !value.trim() || /\[[A-Za-z_][A-Za-z0-9_]*\]/.test(value)) {
    throw new Error(`${key} is required and must not contain a placeholder`);
  }
  return value.trim();
}

function readStorageConfiguration(config: Record<string, unknown>): StorageConfiguration {
  const url = required(config, 'SUPABASE_URL');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTP(S) origin');
  }
  const localHosts = ['localhost', '127.0.0.1', '[::1]'];
  if (
    (parsedUrl.protocol !== 'https:' &&
      !(parsedUrl.protocol === 'http:' && localHosts.includes(parsedUrl.hostname))) ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.pathname !== '/' ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error('SUPABASE_URL must be an HTTPS origin (HTTP is allowed only on loopback)');
  }

  const secretKey = required(config, 'SUPABASE_SECRET_KEY');
  if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(secretKey)) {
    throw new Error('SUPABASE_SECRET_KEY must be a backend secret key');
  }
  const avatarBucket = required(config, 'SUPABASE_AVATAR_BUCKET');
  const documentBucket = required(config, 'SUPABASE_DOCUMENT_BUCKET');
  for (const [key, value] of [
    ['SUPABASE_AVATAR_BUCKET', avatarBucket],
    ['SUPABASE_DOCUMENT_BUCKET', documentBucket],
  ]) {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(value)) {
      throw new Error(`${key} must be a lowercase bucket name of at most 63 characters`);
    }
  }
  if (avatarBucket === documentBucket) {
    throw new Error('Avatar and document buckets must be different');
  }
  return { url: parsedUrl.origin, secretKey, avatarBucket, documentBucket };
}

export function validateStorageEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  readStorageConfiguration(config);
  return config;
}

@Injectable()
export class StorageConfigService {
  readonly values: StorageConfiguration;

  constructor(config: ConfigService) {
    this.values = readStorageConfiguration({
      SUPABASE_URL: config.get<string>('SUPABASE_URL'),
      SUPABASE_SECRET_KEY: config.get<string>('SUPABASE_SECRET_KEY'),
      SUPABASE_AVATAR_BUCKET: config.get<string>('SUPABASE_AVATAR_BUCKET'),
      SUPABASE_DOCUMENT_BUCKET: config.get<string>('SUPABASE_DOCUMENT_BUCKET'),
    });
  }
}
