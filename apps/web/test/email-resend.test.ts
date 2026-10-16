import { describe, expect, it } from 'vitest';

import { emailResendSeconds, formatResendTime } from '@/lib/use-email-flow';

describe('email resend clock', () => {
  it('uses the deadline rather than timer tick counts so background time is accounted for', () => {
    expect(emailResendSeconds(61_000, 1_000)).toBe(60);
    expect(emailResendSeconds(61_000, 24_001)).toBe(37);
    expect(emailResendSeconds(61_000, 60_999)).toBe(1);
    expect(emailResendSeconds(61_000, 61_000)).toBe(0);
    expect(emailResendSeconds(61_000, 100_000)).toBe(0);
  });

  it('formats an accessible minute/second button label', () => {
    expect(formatResendTime(60)).toBe('01:00');
    expect(formatResendTime(59)).toBe('00:59');
    expect(formatResendTime(0)).toBe('00:00');
  });
});
