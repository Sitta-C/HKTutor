import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SaveStudentProfileDto } from '@/profiles/profiles.dto';

describe('SaveStudentProfileDto', () => {
  const validProfile = {
    firstName: 'Suda',
    lastName: 'Dee',
    nickname: 'Da',
    school: 'Demo School',
    gradeLevel: 'Grade 10',
    phone: '0812345678',
  };

  it('trims and accepts every required student profile field', async () => {
    const dto = plainToInstance(SaveStudentProfileDto, {
      ...validProfile,
      firstName: '  Suda  ',
      school: '  Demo School  ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.firstName).toBe('Suda');
    expect(dto.school).toBe('Demo School');
  });

  it.each([
    ['a blank required field', { firstName: '   ' }],
    ['a name over its maximum length', { nickname: 'n'.repeat(61) }],
    ['an invalid phone number', { phone: 'not-a-phone' }],
  ])('rejects %s', async (_label, override) => {
    const dto = plainToInstance(SaveStudentProfileDto, { ...validProfile, ...override });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects a caller-supplied user id instead of allowing ownership reassignment', async () => {
    const dto = plainToInstance(SaveStudentProfileDto, {
      ...validProfile,
      userId: 'another-user-id',
    });

    const errors = await validate(dto, { forbidNonWhitelisted: true, whitelist: true });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('userId');
    expect(errors[0]?.constraints).toHaveProperty('whitelistValidation');
  });
});
