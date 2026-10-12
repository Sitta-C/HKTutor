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
  if (
    audience === 'owner' &&
    (status === 'UNVERIFIED' || status === 'PENDING' || status === 'REJECTED')
  ) {
    return status;
  }
  return null;
}

export const tutorVerificationCopy = {
  en: {
    UNVERIFIED: {
      label: 'No verification documents submitted',
      description:
        'Upload a qualification document to request verification before publishing. You can save courses as drafts.',
    },
    VERIFIED: {
      label: 'Verified tutor',
      description: 'An approved qualification is on file. You can publish your courses.',
    },
    PENDING: {
      label: 'Pending review',
      description:
        'Your qualification documents are awaiting review. You can check their status and save courses as drafts while you wait.',
    },
    REJECTED: {
      label: 'Not verified',
      description:
        'Read the review notes and submit a corrected document before publishing. You can still save drafts.',
    },
    documents: 'Review qualification documents',
  },
  th: {
    UNVERIFIED: {
      label: 'ยังไม่ได้ส่งเอกสารยืนยัน',
      description:
        'อัปโหลดเอกสารคุณวุฒิเพื่อขอรับการตรวจสอบก่อนเผยแพร่คอร์ส คุณสามารถบันทึกคอร์สเป็นฉบับร่างได้',
    },
    VERIFIED: {
      label: 'ผ่านการตรวจสอบแล้ว',
      description: 'มีเอกสารคุณวุฒิที่ผ่านการตรวจสอบแล้ว คุณสามารถเผยแพร่คอร์สได้',
    },
    PENDING: {
      label: 'รอการตรวจสอบ',
      description:
        'เอกสารคุณวุฒิของคุณอยู่ระหว่างรอการตรวจสอบ คุณสามารถตรวจดูสถานะและบันทึกคอร์สเป็นฉบับร่างระหว่างรอได้',
    },
    REJECTED: {
      label: 'ไม่ผ่านการตรวจสอบ',
      description: 'อ่านเหตุผลและส่งเอกสารที่แก้ไขแล้วก่อนเผยแพร่คอร์ส คุณยังบันทึกฉบับร่างได้',
    },
    documents: 'ดูเอกสารและผลการตรวจสอบ',
  },
} as const;
