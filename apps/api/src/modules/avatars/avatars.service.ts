import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AccountStatus, Role, StorageObjectPurpose } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import {
  STORAGE_CLEANUP_GRACE_MS,
  StorageCleanupService,
} from '@infrastructure/storage/storage-cleanup.service';
import { StorageService } from '@infrastructure/storage/storage.service';
import { SIGNED_URL_MAX_TTL_SECONDS } from '@infrastructure/storage/storage.types';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { normalizeAvatar } from '@modules/avatars/avatar-image';
import { publicTutorWhere } from '@modules/tutors/public-tutor-access';

import type { Prisma } from '@generated/prisma/client';
import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type {
  AvatarReadResponseDto,
  AvatarMutationResponseDto,
} from '@modules/avatars/avatars.swagger';

const avatarSelect = { avatarObjectPath: true, avatarUpdatedAt: true } satisfies Prisma.UserSelect;
const ownerSelect = {
  ...avatarSelect,
  accountStatus: true,
  deletedAt: true,
  policyVersion: true,
  role: true,
} satisfies Prisma.UserSelect;
type AvatarAccount = Prisma.UserGetPayload<{ select: typeof avatarSelect }>;

@Injectable()
export class AvatarsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cleanup: StorageCleanupService,
  ) {}

  async getMine(user: AuthenticatedUser): Promise<AvatarReadResponseDto> {
    return this.sign(await this.assertOwner(user));
  }

  async getPublicTutor(tutorId: string): Promise<AvatarReadResponseDto> {
    const tutor = await this.prisma.tutorProfile.findFirst({
      where: { ...publicTutorWhere, userId: tutorId },
      select: { user: { select: avatarSelect } },
    });
    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }
    return this.sign(tutor.user);
  }

  async upload(
    user: AuthenticatedUser,
    file: Express.Multer.File | undefined,
  ): Promise<AvatarMutationResponseDto> {
    await this.assertOwner(user);
    if (!file) {
      throw new BadRequestException('An avatar file is required');
    }
    const normalized = await normalizeAvatar({ buffer: file.buffer, mimeType: file.mimetype });
    await this.storage.assertPrivateAvatarBucket();
    const prepared = this.storage.prepareAvatar(user.id, normalized);
    // Persist the path before network I/O, including uploads whose outcome is ambiguous.
    await this.prisma.storageCleanupIntent.create({
      data: {
        purpose: StorageObjectPurpose.AVATAR,
        objectPath: prepared.objectPath,
        nextAttemptAt: new Date(Date.now() + STORAGE_CLEANUP_GRACE_MS),
      },
    });
    await this.storage.uploadPrepared(prepared);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.lockOwner(tx, user.id);
        const account = await this.assertOwner(user, tx);
        const intents = await tx.$queryRaw<Array<{ objectPath: string }>>`
          SELECT "objectPath" FROM "StorageCleanupIntent"
          WHERE "purpose" = ${StorageObjectPurpose.AVATAR}::"StorageObjectPurpose"
            AND "objectPath" = ${prepared.objectPath} FOR UPDATE`;
        if (!intents.length) {
          throw new ServiceUnavailableException('Avatar upload expired before metadata was saved');
        }
        await this.queueOldAvatar(tx, account.avatarObjectPath);
        const avatarUpdatedAt = new Date(
          Math.max(Date.now(), (account.avatarUpdatedAt?.getTime() ?? 0) + 1),
        );
        await tx.user.update({
          where: { id: user.id },
          data: {
            avatarObjectPath: prepared.objectPath,
            avatarMimeType: prepared.mimeType,
            avatarSizeBytes: prepared.sizeBytes,
            avatarUpdatedAt,
          },
          select: { id: true },
        });
        await tx.storageCleanupIntent.delete({
          where: {
            purpose_objectPath: {
              purpose: StorageObjectPurpose.AVATAR,
              objectPath: prepared.objectPath,
            },
          },
        });
        return { avatarUpdatedAt: avatarUpdatedAt.toISOString() };
      });
      void this.cleanup.recoverPending();
      return result;
    } catch (error) {
      // Leave the upload intent to recover after the grace period; a commit may be ambiguous.
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'Avatar metadata could not be saved; cleanup will retry',
      );
    }
  }

  async remove(user: AuthenticatedUser): Promise<AvatarMutationResponseDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, user.id);
      const account = await this.assertOwner(user, tx);
      await this.queueOldAvatar(tx, account.avatarObjectPath);
      await tx.user.update({
        where: { id: user.id },
        data: {
          avatarObjectPath: null,
          avatarMimeType: null,
          avatarSizeBytes: null,
          avatarUpdatedAt: null,
        },
        select: { id: true },
      });
    });
    void this.cleanup.recoverPending();
    return { avatarUpdatedAt: null };
  }

  private async assertOwner(user: AuthenticatedUser, db: Prisma.TransactionClient = this.prisma) {
    if (user.role !== Role.STUDENT && user.role !== Role.TUTOR) {
      throw new ForbiddenException('Only students and tutors can manage an avatar');
    }
    const account = await db.user.findUnique({ where: { id: user.id }, select: ownerSelect });
    if (!account || account.deletedAt !== null) {
      throw new NotFoundException('Account not found');
    }
    if (account.accountStatus !== AccountStatus.ACTIVE || account.role !== user.role) {
      throw new ForbiddenException('Account cannot manage an avatar');
    }
    if (account.policyVersion !== CURRENT_PRIVACY_POLICY_VERSION) {
      throw new BadRequestException('Accept the current privacy notice before accessing an avatar');
    }
    return account;
  }

  private async sign(account: AvatarAccount): Promise<AvatarReadResponseDto> {
    if (!account.avatarObjectPath || !account.avatarUpdatedAt) {
      return { avatar: null };
    }
    await this.storage.assertPrivateAvatarBucket();
    const issuedAt = Date.now();
    const url = await this.storage.createSignedUrl('avatar', account.avatarObjectPath);
    return {
      avatar: {
        url,
        expiresAt: new Date(issuedAt + SIGNED_URL_MAX_TTL_SECONDS * 1000).toISOString(),
        updatedAt: account.avatarUpdatedAt.toISOString(),
      },
    };
  }

  private async lockOwner(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
  }

  private async queueOldAvatar(
    tx: Prisma.TransactionClient,
    objectPath: string | null,
  ): Promise<void> {
    if (objectPath) {
      await tx.storageCleanupIntent.create({
        data: {
          purpose: StorageObjectPurpose.AVATAR,
          objectPath,
          nextAttemptAt: new Date(),
        },
      });
    }
  }
}
