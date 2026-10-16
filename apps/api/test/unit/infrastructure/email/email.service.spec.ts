import { ConfigService } from '@nestjs/config';

import { AuthConfigService } from '@config/auth.config';
import { EmailService } from '@infrastructure/email/email.service';

interface EmailInput {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}
const mockSend = jest.fn<Promise<{ error: { message: string } | null }>, [EmailInput]>();
jest.mock('resend', () => ({
  Resend: class {
    emails = { send: mockSend };
  },
}));

const config = new AuthConfigService(
  new ConfigService({
    RESEND_API_KEY: 're_test',
    EMAIL_FROM: 'HKTutor <test@example.com>',
    APP_URL: 'https://hktutor.example.com',
    PASSWORD_RESET_TTL_MINUTES: '30',
  }),
);

describe('password reset emails', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ error: null });
  });

  it('uses the configured app origin, an encoded token and the configured lifetime', async () => {
    await new EmailService(config).sendPasswordResetEmail('student@example.com', 'token&value');
    const input = mockSend.mock.calls[0]?.[0];
    expect(input?.to).toBe('student@example.com');
    expect(input?.from).toBe('HKTutor <test@example.com>');
    expect(input?.text).toContain('https://hktutor.example.com/reset-password?token=token%26value');
    expect(input?.text).toContain('30 minutes');
    expect(input?.html).toContain('ตั้งรหัสผ่าน');
  });

  it('turns provider failures into a generic error without leaking response details', async () => {
    mockSend.mockResolvedValueOnce({ error: { message: 'private details' } });
    await expect(
      new EmailService(config).sendPasswordResetEmail('student@example.com', 'token'),
    ).rejects.toThrow('Password reset email could not be sent');
  });

  it('defaults to 30 minutes and rejects invalid configured lifetimes', () => {
    expect(new AuthConfigService(new ConfigService()).passwordResetTtlMinutes).toBe(30);
    for (const value of ['0', '-1', 'bad', '1.5']) {
      expect(
        () =>
          new AuthConfigService(new ConfigService({ PASSWORD_RESET_TTL_MINUTES: value }))
            .passwordResetTtlMinutes,
      ).toThrow('PASSWORD_RESET_TTL_MINUTES must be a positive integer');
    }
  });
});
