import { AccountStatus, Role, TutorVerificationStatus } from '@/generated/prisma/enums';

import type { Prisma } from '@/generated/prisma/client';

export type PublicTutorVerificationStatus = typeof TutorVerificationStatus.VERIFIED;

export const publicTutorWhere = {
  verificationStatus: TutorVerificationStatus.VERIFIED,
  user: {
    accountStatus: AccountStatus.ACTIVE,
    deletedAt: null,
    role: Role.TUTOR,
  },
} satisfies Prisma.TutorProfileWhereInput;

export function isPublicTutorVerificationStatus(
  status: TutorVerificationStatus,
): status is PublicTutorVerificationStatus {
  return status === TutorVerificationStatus.VERIFIED;
}
