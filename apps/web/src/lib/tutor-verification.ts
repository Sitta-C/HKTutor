import type { TutorProfile } from '@/lib/api/types';

export type TutorVerificationAudience = 'public' | 'owner';
export type TutorVerificationStatus = TutorProfile['verificationStatus'];

export function visibleTutorVerificationStatus(
  status: unknown,
  audience: TutorVerificationAudience,
): TutorVerificationStatus | null {
  if (status === 'VERIFIED') {
    return status;
  }
  if (audience === 'owner' && (status === 'PENDING' || status === 'REJECTED')) {
    return status;
  }
  return null;
}

export const tutorVerificationCopy = {
  en: {
    VERIFIED: {
      label: 'Verified tutor',
      description: 'An approved qualification is on file. You can publish your courses.',
    },
    PENDING: {
      label: 'Pending review',
      description:
        'Upload qualifications or check their review status. You can save courses as drafts while your profile is awaiting verification.',
    },
    REJECTED: {
      label: 'Not verified',
      description:
        'Read the review notes and submit a corrected document before publishing. You can still save drafts.',
    },
    documents: 'Review qualification documents',
  },
  th: {
    VERIFIED: {
      label: 'ผ่านการตรวจสอบแล้ว',
      description: 'มีเอกสารคุณวุฒิที่ผ่านการตรวจสอบแล้ว คุณสามารถเผยแพร่คอร์สได้',
    },
    PENDING: {
      label: 'รอการตรวจสอบ',
      description:
        'อัปโหลดเอกสารคุณวุฒิหรือตรวจดูผลการตรวจสอบ ระหว่างรอสามารถบันทึกคอร์สเป็นฉบับร่างได้',
    },
    REJECTED: {
      label: 'ไม่ผ่านการตรวจสอบ',
      description: 'อ่านเหตุผลและส่งเอกสารที่แก้ไขแล้วก่อนเผยแพร่คอร์ส คุณยังบันทึกฉบับร่างได้',
    },
    documents: 'ดูเอกสารและผลการตรวจสอบ',
  },
} as const;
