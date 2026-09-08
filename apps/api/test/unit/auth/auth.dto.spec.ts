import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RegisterDto } from '@/auth/auth.dto';

describe('RegisterDto', () => {
  it('normalizes a valid email/password registration', async () => {
    const dto = plainToInstance(RegisterDto, {
      email: '  Student@Example.COM ',
      password: 'password123',
      role: 'student',
      consent: true,
      policyVersion: '2026-09-08',
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
      policyVersion: '2026-09-08',
      ...override,
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
