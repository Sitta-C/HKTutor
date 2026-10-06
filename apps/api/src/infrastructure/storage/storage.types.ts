import type { SupabaseClient } from '@supabase/supabase-js';

export const STORAGE_CLIENT = Symbol('STORAGE_CLIENT');

// Only Storage is available through this provider; database access remains Prisma-owned.
export type StorageClient = Pick<SupabaseClient<Record<string, never>>, 'storage'>;

export type StoragePurpose = 'avatar' | 'document';

export interface StorageUpload {
  buffer: Buffer;
  mimeType: string;
}

export interface StoredFile {
  objectPath: string;
  mimeType: string;
  sizeBytes: number;
}

export const AVATAR_MAX_SIZE_BYTES = 2 * 1024 * 1024;
export const DOCUMENT_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const SIGNED_URL_MAX_TTL_SECONDS = 300;
