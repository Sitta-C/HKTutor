import { describe, expect, it } from 'vitest';

import { tutorBookingInboxCopy } from '@/components/bookings/tutor-booking-inbox-copy';
import { conversationCopy } from '@/components/conversations/conversation-copy';
import { tutorSearchCopy } from '@/components/tutors/tutor-search-copy';
import { translations } from '@/lib/i18n';
import { privacyNoticeCopy } from '@/lib/privacy-notice-copy';

type CopyNode = string | readonly CopyNode[] | { readonly [key: string]: CopyNode };

function collectShape(value: CopyNode, path = 'root'): string[] {
  if (typeof value === 'string') return [`${path}:string`];
  if (Array.isArray(value)) {
    return [
      `${path}:array(${value.length})`,
      ...value.flatMap((item, index) => collectShape(item, `${path}[${index}]`)),
    ];
  }

  const objectValue = value as Readonly<Record<string, CopyNode>>;
  return Object.keys(objectValue)
    .sort()
    .flatMap((key) => collectShape(objectValue[key]!, `${path}.${key}`));
}

function collectStrings(value: CopyNode): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  return Object.values(value as Readonly<Record<string, CopyNode>>).flatMap(collectStrings);
}

function expectSymmetricCopy(en: CopyNode, th: CopyNode) {
  expect(collectShape(th)).toEqual(collectShape(en));
  expect(collectStrings(en).every((value) => value.trim().length > 0)).toBe(true);
  expect(collectStrings(th).every((value) => value.trim().length > 0)).toBe(true);
}

describe('bilingual copy contracts', () => {
  it('keeps the complete shared translation tree symmetric and non-empty', () => {
    expectSymmetricCopy(translations.en, translations.th);
  });

  it('keeps exported feature copy symmetric and non-empty', () => {
    expectSymmetricCopy(tutorBookingInboxCopy.en, tutorBookingInboxCopy.th);
    expectSymmetricCopy(conversationCopy.en, conversationCopy.th);
    expectSymmetricCopy(tutorSearchCopy.en, tutorSearchCopy.th);
    expectSymmetricCopy(privacyNoticeCopy.en, privacyNoticeCopy.th);
  });
});
