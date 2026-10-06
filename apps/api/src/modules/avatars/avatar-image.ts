import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { filetypemime } from 'magic-bytes.js';
import sharp from 'sharp';

import { AVATAR_MAX_SIZE_BYTES } from '@infrastructure/storage/storage.types';

import type { StorageUpload } from '@infrastructure/storage/storage.types';

export async function normalizeAvatar(file: StorageUpload): Promise<StorageUpload> {
  if (!file.buffer.length) {
    throw new BadRequestException('A non-empty avatar file is required');
  }
  if (file.buffer.length > AVATAR_MAX_SIZE_BYTES) {
    throw new PayloadTooLargeException('Avatar must not exceed 2 MiB');
  }
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType) ||
    !filetypemime(file.buffer).includes(file.mimeType)
  ) {
    throw new BadRequestException('Avatar must be a JPEG, PNG, or WebP with matching contents');
  }
  try {
    const image = sharp(file.buffer, { failOn: 'warning', limitInputPixels: 16_000_000 });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) > 1) {
      throw new Error('Animated avatars are unsupported');
    }
    // Re-encoding discards EXIF/location metadata; bound decoded pixels before resizing.
    const buffer = await image
      .rotate()
      .resize(512, 512, { fit: 'cover', position: 'centre', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return { buffer, mimeType: 'image/webp' };
  } catch {
    throw new BadRequestException('Avatar is invalid, animated, or exceeds 16 megapixels');
  }
}
