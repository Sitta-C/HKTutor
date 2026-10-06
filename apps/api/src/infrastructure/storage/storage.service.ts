import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { filetypemime } from 'magic-bytes.js';

import { StorageConfigService } from '@config/storage.config';
import {
  AVATAR_MAX_SIZE_BYTES,
  DOCUMENT_MAX_SIZE_BYTES,
  SIGNED_URL_MAX_TTL_SECONDS,
  STORAGE_CLIENT,
} from '@infrastructure/storage/storage.types';

import type {
  PreparedStorageUpload,
  StorageClient,
  StoragePurpose,
  StorageUpload,
  StoredFile,
} from '@infrastructure/storage/storage.types';

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
const MIME_TYPES: Record<StoragePurpose, readonly string[]> = {
  avatar: ['image/jpeg', 'image/png', 'image/webp'],
  document: ['application/pdf', 'image/jpeg', 'image/png'],
};

@Injectable()
export class StorageService {
  constructor(
    private readonly config: StorageConfigService,
    @Inject(STORAGE_CLIENT) private readonly client: StorageClient,
  ) {}

  async uploadAvatar(ownerUserId: string, file: StorageUpload): Promise<StoredFile> {
    return this.upload('avatar', ownerUserId, file);
  }

  async uploadDocument(ownerUserId: string, file: StorageUpload): Promise<StoredFile> {
    return this.upload('document', ownerUserId, file);
  }

  prepareDocument(ownerUserId: string, file: StorageUpload): PreparedStorageUpload {
    return this.prepare('document', ownerUserId, file);
  }

  async uploadPrepared(file: PreparedStorageUpload): Promise<StoredFile> {
    // Revalidate before network I/O; prepared uploads are internal, never HTTP input.
    this.validateObjectPath(file.objectPath);
    const owner = file.objectPath.split('/')[0] ?? '';
    const validated = this.prepare(file.purpose, owner, file);
    if (
      !file.objectPath.endsWith(`.${EXTENSIONS[validated.mimeType]}`) ||
      file.sizeBytes !== validated.sizeBytes
    ) {
      throw new BadRequestException('Prepared upload metadata does not match its file');
    }
    if (file.purpose === 'document') {
      await this.assertPrivateDocumentBucket();
    }
    await this.request(
      () =>
        this.client.storage.from(this.bucket(file.purpose)).upload(file.objectPath, file.buffer, {
          contentType: file.mimeType,
          cacheControl: file.purpose === 'avatar' ? '3600' : '0',
          upsert: false,
        }),
      'File could not be uploaded',
    );
    return { objectPath: file.objectPath, mimeType: file.mimeType, sizeBytes: file.sizeBytes };
  }

  async remove(purpose: StoragePurpose, objectPath: string): Promise<void> {
    this.validateObjectPath(objectPath);
    await this.request(
      () => this.client.storage.from(this.bucket(purpose)).remove([objectPath]),
      'Stored file could not be deleted',
    );
  }

  getAvatarPublicUrl(objectPath: string): string {
    this.validateObjectPath(objectPath);
    return this.client.storage.from(this.bucket('avatar')).getPublicUrl(objectPath).data.publicUrl;
  }

  async createSignedUrl(
    purpose: StoragePurpose,
    objectPath: string,
    expiresIn = SIGNED_URL_MAX_TTL_SECONDS,
  ): Promise<string> {
    this.validateObjectPath(objectPath);
    if (
      !Number.isSafeInteger(expiresIn) ||
      expiresIn <= 0 ||
      expiresIn > SIGNED_URL_MAX_TTL_SECONDS
    ) {
      throw new BadRequestException('Signed URL lifetime must be between 1 and 300 seconds');
    }
    if (purpose === 'document') {
      await this.assertPrivateDocumentBucket();
    }
    const data = await this.request(
      () => this.client.storage.from(this.bucket(purpose)).createSignedUrl(objectPath, expiresIn),
      'Stored file URL could not be created',
    );
    return data.signedUrl;
  }

  private async upload(
    purpose: StoragePurpose,
    ownerUserId: string,
    file: StorageUpload,
  ): Promise<StoredFile> {
    return this.uploadPrepared(this.prepare(purpose, ownerUserId, file));
  }

  private prepare(
    purpose: StoragePurpose,
    ownerUserId: string,
    file: StorageUpload,
  ): PreparedStorageUpload {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ownerUserId)) {
      throw new BadRequestException('File owner must be a user UUID');
    }
    const limit = purpose === 'avatar' ? AVATAR_MAX_SIZE_BYTES : DOCUMENT_MAX_SIZE_BYTES;
    if (file.buffer.length === 0) {
      throw new BadRequestException('File must not be empty');
    }
    if (file.buffer.length > limit) {
      throw new PayloadTooLargeException('File exceeds the upload size limit');
    }
    // Content-Type is supplied by the caller; require a matching file signature as well.
    if (
      !MIME_TYPES[purpose].includes(file.mimeType) ||
      !filetypemime(file.buffer).includes(file.mimeType)
    ) {
      throw new BadRequestException('File type is unsupported or does not match its contents');
    }
    const extension = EXTENSIONS[file.mimeType];
    if (!extension) {
      throw new BadRequestException('File type is unsupported');
    }
    const objectPath = `${ownerUserId}/${randomUUID()}.${extension}`;
    return {
      objectPath,
      mimeType: file.mimeType,
      sizeBytes: file.buffer.length,
      purpose,
      buffer: file.buffer,
    };
  }

  private bucket(purpose: StoragePurpose): string {
    switch (purpose) {
      case 'avatar':
        return this.config.values.avatarBucket;
      case 'document':
        return this.config.values.documentBucket;
      default:
        throw new BadRequestException('Storage purpose is unsupported');
    }
  }

  private validateObjectPath(objectPath: string): void {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(objectPath) ||
      objectPath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      throw new BadRequestException('Object path must be a safe relative storage path');
    }
  }

  private async assertPrivateDocumentBucket(): Promise<void> {
    const bucket = await this.request(
      () => this.client.storage.getBucket(this.bucket('document')),
      'Document bucket could not be checked',
    );
    if (bucket.public !== false) {
      throw new ServiceUnavailableException('Document storage must use a private bucket');
    }
  }

  private async request<T>(
    operation: () => Promise<{ data: T | null; error: unknown }>,
    message: string,
  ): Promise<T> {
    try {
      const { data, error } = await operation();
      if (error || data === null) {
        throw new Error('Storage request failed');
      }
      return data;
    } catch {
      // Provider errors may contain paths or credentials; expose only our stable message.
      throw new ServiceUnavailableException(message);
    }
  }
}
