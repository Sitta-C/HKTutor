import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ForgotPasswordDto, RegisterDto, ResetPasswordDto } from '@modules/auth/auth.dto';

describe('RegisterDto', () => {
  it('normalizes a valid email/password registration', async () => {
    const dto = plainToInstance(RegisterDto, {
      email: '  Student@Example.COM ',
      password: 'password123',
      role: 'student',
      consent: true,
      policyVersion: '2026-09-30',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.email).toBe('student@example.com');
  });

  it.each([
    ['administrator role', { role: 'admin' }],
    ['weak password', { password: 'allletters' }],
    ['unknown policy version', { policyVersion: '2026-01-01' }],
  ])('rejects %s', async (_label, override) => {
    const dto = plainToInstance(RegisterDto, {
      email: 'student@example.com',
      password: 'password123',
      role: 'student',
      consent: true,
      policyVersion: '2026-09-30',
      ...override,
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});

describe('password recovery DTOs', () => {
  it('normalizes the recovery address', async () => {
    const dto = plainToInstance(ForgotPasswordDto, { email: ' Student@Example.COM ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.email).toBe('student@example.com');
  });

  it.each([
    { token: 'short', password: 'password123' },
    { token: 'a'.repeat(43), password: 'short1' },
    { token: 'a'.repeat(43), password: 'allletters' },
    { token: 'a'.repeat(43), password: '1234567890' },
    { token: 'a'.repeat(43), password: 'a1'.repeat(65) },
    { token: '<'.repeat(43), password: 'password123' },
    { token: 'a'.repeat(43) },
  ])('rejects invalid reset data %#', async (input) => {
    expect(await validate(plainToInstance(ResetPasswordDto, input))).not.toHaveLength(0);
  });

  it('accepts a reset token and the existing password policy', async () => {
    expect(
      await validate(
        plainToInstance(ResetPasswordDto, { token: 'a'.repeat(43), password: 'password123' }),
      ),
    ).toHaveLength(0);
  });
});
