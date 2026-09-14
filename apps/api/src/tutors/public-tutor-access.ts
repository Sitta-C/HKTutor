import { AccountStatus, Role, TutorVerificationStatus } from '@/generated/prisma/client';

import type { Prisma } from '@/generated/prisma/client';

export const publicTutorWhere = {
  verificationStatus: {
    in: [TutorVerificationStatus.PENDING, TutorVerificationStatus.VERIFIED],
  },
  user: {
    accountStatus: AccountStatus.ACTIVE,
    deletedAt: null,
    role: Role.TUTOR,
  },
} satisfies Prisma.TutorProfileWhereInput;

export function toPublicTutorVerificationStatus(
  status: TutorVerificationStatus,
): 'PENDING' | 'VERIFIED' {
  if (status === TutorVerificationStatus.PENDING) return 'PENDING';
  if (status === TutorVerificationStatus.VERIFIED) return 'VERIFIED';
  throw new Error('Unexpected public tutor verification status');
}
