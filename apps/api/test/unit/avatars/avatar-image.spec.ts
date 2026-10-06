import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import sharp from 'sharp';

import { AVATAR_MAX_SIZE_BYTES } from '@infrastructure/storage/storage.types';
import { normalizeAvatar } from '@modules/avatars/avatar-image';

describe('avatar image normalization', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'decodes %s and strips metadata from a centered WebP',
    async (format) => {
      const buffer = await sharp({
        create: { width: 900, height: 600, channels: 3, background: '#4285aa' },
      })
        .withMetadata({ orientation: 6 })
        .toFormat(format)
        .toBuffer();
      const output = await normalizeAvatar({ buffer, mimeType: `image/${format}` });
      const metadata = await sharp(output.buffer).metadata();
      expect(output.mimeType).toBe('image/webp');
      expect(metadata).toMatchObject({ format: 'webp', width: 512, height: 512 });
      expect(metadata.exif).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
    },
  );

  it('does not upscale a small image', async () => {
    const buffer = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    const output = await normalizeAvatar({ buffer, mimeType: 'image/png' });
    expect(await sharp(output.buffer).metadata()).toMatchObject({ width: 32, height: 32 });
  });

  it('rejects animated WebP files instead of silently accepting the first frame', async () => {
    const raw = Buffer.alloc(16 * 32 * 3);
    raw.fill(255, 0, 16 * 16 * 3);
    const buffer = await sharp(raw, {
      raw: { width: 16, height: 32, pageHeight: 16, channels: 3 },
    })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(buffer).metadata()).pages).toBe(2);
    await expect(normalizeAvatar({ buffer, mimeType: 'image/webp' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    { buffer: Buffer.alloc(0), mimeType: 'image/png' },
    { buffer: Buffer.from('<svg/>'), mimeType: 'image/svg+xml' },
    { buffer: Buffer.from('not a png'), mimeType: 'image/png' },
    { buffer: Buffer.from('89504e470d0a1a0a', 'hex'), mimeType: 'image/png' },
  ])('rejects empty, unsupported, forged, and undecodable images', async (file) => {
    await expect(normalizeAvatar(file)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects MIME mismatches', async () => {
    const buffer = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    await expect(normalizeAvatar({ buffer, mimeType: 'image/jpeg' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects oversized input before decoding', async () => {
    await expect(
      normalizeAvatar({ buffer: Buffer.alloc(AVATAR_MAX_SIZE_BYTES + 1), mimeType: 'image/png' }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('accepts the inclusive 2 MiB boundary', async () => {
    const image = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    const buffer = Buffer.alloc(AVATAR_MAX_SIZE_BYTES);
    image.copy(buffer);
    await expect(normalizeAvatar({ buffer, mimeType: 'image/png' })).resolves.toMatchObject({
      mimeType: 'image/webp',
    });
  });

  it('bounds decoded pixels even when the compressed file is small', async () => {
    const buffer = await sharp({
      create: { width: 4001, height: 4000, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    await expect(normalizeAvatar({ buffer, mimeType: 'image/png' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
