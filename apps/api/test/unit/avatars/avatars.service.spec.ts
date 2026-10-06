import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';

import { AccountStatus, Role } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { StorageService } from '@infrastructure/storage/storage.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import {
  AVATAR_UPLOAD_GRACE_MS,
  AvatarRecoveryService,
} from '@modules/avatars/avatar-recovery.service';
import { AvatarsService } from '@modules/avatars/avatars.service';
import { publicTutorWhere } from '@modules/tutors/public-tutor-access';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type { TestingModule } from '@nestjs/testing';

const USER_ID = '20000000-0000-4000-8000-000000000001';
const OLD_PATH = `${USER_ID}/old.webp`;
const NEW_PATH = `${USER_ID}/new.webp`;
const UPDATED_AT = new Date('2026-10-06T07:00:00Z');
const anyString: unknown = expect.any(String);
const anyNumber: unknown = expect.any(Number);
const anyDate: unknown = expect.any(Date);
const anyBuffer: unknown = expect.any(Buffer);
const user: AuthenticatedUser = {
  id: USER_ID,
  email: 'student@example.test',
  role: Role.STUDENT,
  sessionId: 'session-id',
};

describe('AvatarsService', () => {
  const db = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    tutorProfile: { findFirst: jest.fn() },
    avatarUploadIntent: {
      create: jest.fn<Promise<unknown>, [{ data: { objectPath: string; nextAttemptAt: Date } }]>(),
      delete: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  const transaction = jest.fn();
  const storage = {
    assertPrivateAvatarBucket: jest.fn(),
    prepareAvatar: jest.fn(),
    uploadPrepared: jest.fn(),
    createSignedUrl: jest.fn(),
    remove: jest.fn(),
  };
  const recovery = { recoverPending: jest.fn() };
  let module: TestingModule;
  let service: AvatarsService;
  let file: Express.Multer.File;

  beforeAll(async () => {
    const buffer = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    file = {
      buffer,
      mimetype: 'image/png',
      fieldname: 'file',
      originalname: '../../private.png',
      encoding: '7bit',
      size: buffer.length,
      destination: '',
      filename: '',
      path: '',
      stream: sharp(),
    };
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    db.user.findUnique.mockResolvedValue({
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      deletedAt: null,
      policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      avatarObjectPath: OLD_PATH,
      avatarUpdatedAt: UPDATED_AT,
    });
    db.$queryRaw.mockResolvedValue([{ objectPath: NEW_PATH }]);
    transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) =>
      callback(db),
    );
    storage.prepareAvatar.mockImplementation(
      (owner: string, normalized: { buffer: Buffer; mimeType: string }) => ({
        ...normalized,
        objectPath: NEW_PATH,
        sizeBytes: normalized.buffer.length,
        purpose: 'avatar',
      }),
    );
    storage.createSignedUrl.mockResolvedValue('https://storage.example.test/signed');
    recovery.recoverPending.mockResolvedValue(undefined);
    module = await Test.createTestingModule({
      providers: [
        AvatarsService,
        { provide: PrismaService, useValue: { ...db, $transaction: transaction } },
        { provide: StorageService, useValue: storage },
        { provide: AvatarRecoveryService, useValue: recovery },
      ],
    }).compile();
    service = module.get(AvatarsService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('signs only the owner reference and never exposes storage metadata', async () => {
    const result = await service.getMine(user);
    expect(result).toEqual({
      avatar: {
        url: 'https://storage.example.test/signed',
        expiresAt: anyString,
        updatedAt: UPDATED_AT.toISOString(),
      },
    });
    expect(storage.createSignedUrl).toHaveBeenCalledWith('avatar', OLD_PATH);
    expect(Date.parse(result.avatar?.expiresAt ?? '') - Date.now()).toBeLessThanOrEqual(300000);
    expect(result).not.toHaveProperty('objectPath');
  });

  it('returns null without Storage I/O for an account without a photo', async () => {
    db.user.findUnique.mockResolvedValue({
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      deletedAt: null,
      policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      avatarObjectPath: null,
      avatarUpdatedAt: null,
    });
    await expect(service.getMine(user)).resolves.toEqual({ avatar: null });
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it.each([Role.STUDENT, Role.TUTOR])(
    'persists normalized avatar metadata for %s without requiring a profile row',
    async (role) => {
      db.user.findUnique.mockResolvedValue({
        role,
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        avatarObjectPath: OLD_PATH,
        avatarUpdatedAt: UPDATED_AT,
      });
      const result = await service.upload({ ...user, role }, file);
      expect(result.avatarUpdatedAt).toBeTruthy();
      expect(storage.prepareAvatar).toHaveBeenCalledWith(USER_ID, {
        buffer: anyBuffer,
        mimeType: 'image/webp',
      });
      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: {
          avatarObjectPath: NEW_PATH,
          avatarMimeType: 'image/webp',
          avatarSizeBytes: anyNumber,
          avatarUpdatedAt: anyDate,
        },
        select: { id: true },
      });
      expect(db.avatarUploadIntent.create).toHaveBeenNthCalledWith(2, {
        data: { objectPath: OLD_PATH, nextAttemptAt: anyDate },
      });
      expect(db.avatarUploadIntent.delete).toHaveBeenCalledWith({
        where: { objectPath: NEW_PATH },
      });
      expect(storage.remove).not.toHaveBeenCalled();
      expect(db.avatarUploadIntent.create.mock.invocationCallOrder[0]).toBeLessThan(
        storage.uploadPrepared.mock.invocationCallOrder[0] ?? 0,
      );
      expect(storage.uploadPrepared.mock.invocationCallOrder[0]).toBeLessThan(
        db.user.update.mock.invocationCallOrder[0] ?? 0,
      );
    },
  );

  it('retains the durable upload intent and old reference on ambiguous Storage failure', async () => {
    storage.uploadPrepared.mockRejectedValueOnce(new ServiceUnavailableException('timeout'));
    await expect(service.upload(user, file)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.avatarUploadIntent.delete).not.toHaveBeenCalled();
    const intent = db.avatarUploadIntent.create.mock.calls[0]?.[0];
    expect(intent?.data.nextAttemptAt.getTime()).toBeGreaterThan(
      Date.now() + AVATAR_UPLOAD_GRACE_MS - 1000,
    );
  });

  it('does not install a photo if recovery already claimed its expired intent', async () => {
    db.$queryRaw.mockResolvedValue([]);
    await expect(service.upload(user, file)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('keeps recovery intent if database commit fails', async () => {
    transaction.mockRejectedValueOnce(new Error('database secret details'));
    await expect(service.upload(user, file)).rejects.toThrow(
      'Avatar metadata could not be saved; cleanup will retry',
    );
    expect(db.avatarUploadIntent.delete).not.toHaveBeenCalled();
  });

  it('removes all metadata atomically and queues deletion', async () => {
    await expect(service.remove(user)).resolves.toEqual({ avatarUpdatedAt: null });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: {
        avatarObjectPath: null,
        avatarMimeType: null,
        avatarSizeBytes: null,
        avatarUpdatedAt: null,
      },
      select: { id: true },
    });
    expect(db.avatarUploadIntent.create).toHaveBeenCalledWith({
      data: { objectPath: OLD_PATH, nextAttemptAt: anyDate },
    });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('rejects admin access before any persistence', async () => {
    await expect(service.upload({ ...user, role: Role.ADMIN }, file)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects missing files without preparing or uploading an object', async () => {
    await expect(service.upload(user, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.prepareAvatar).not.toHaveBeenCalled();
    expect(storage.uploadPrepared).not.toHaveBeenCalled();
  });

  it('refuses a public avatar bucket before writing any file metadata', async () => {
    storage.assertPrivateAvatarBucket.mockRejectedValueOnce(
      new ServiceUnavailableException('Avatar storage must use a private bucket'),
    );
    await expect(service.upload(user, file)).rejects.toThrow(
      'Avatar storage must use a private bucket',
    );
    expect(db.avatarUploadIntent.create).not.toHaveBeenCalled();
    expect(storage.uploadPrepared).not.toHaveBeenCalled();
  });

  it.each([
    { overrides: { deletedAt: new Date() }, exception: NotFoundException },
    { overrides: { accountStatus: AccountStatus.SUSPENDED }, exception: ForbiddenException },
    { overrides: { role: Role.TUTOR }, exception: ForbiddenException },
    { overrides: { policyVersion: 'old' }, exception: BadRequestException },
  ])('rejects unavailable or unauthorized owner state', async ({ overrides, exception }) => {
    db.user.findUnique.mockResolvedValue({
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      deletedAt: null,
      policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      ...overrides,
    });
    await expect(service.upload(user, file)).rejects.toBeInstanceOf(exception);
    expect(storage.uploadPrepared).not.toHaveBeenCalled();
  });

  it('rechecks consent inside the locked write transaction', async () => {
    db.user.findUnique
      .mockResolvedValueOnce({
        role: Role.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      })
      .mockResolvedValueOnce({
        role: Role.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        policyVersion: 'old',
      });
    await expect(service.upload(user, file)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('uses the public tutor visibility filter before signing', async () => {
    db.tutorProfile.findFirst.mockResolvedValue({
      user: { avatarObjectPath: OLD_PATH, avatarUpdatedAt: UPDATED_AT },
    });
    await service.getPublicTutor(USER_ID);
    expect(db.tutorProfile.findFirst).toHaveBeenCalledWith({
      where: { ...publicTutorWhere, userId: USER_ID },
      select: { user: { select: { avatarObjectPath: true, avatarUpdatedAt: true } } },
    });
  });

  it('does not sign a student or hidden tutor through the public endpoint', async () => {
    db.tutorProfile.findFirst.mockResolvedValue(null);
    await expect(service.getPublicTutor(USER_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
});
