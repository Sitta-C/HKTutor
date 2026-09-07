import { validate } from 'class-validator';

import { OnboardingConsentDto } from '@/users/users.dto';

describe('OnboardingConsentDto', () => {
  it('accepts a fully valid consent payload', async () => {
    const dto = new OnboardingConsentDto();
    Object.assign(dto, { consent: true, policyVersion: '2026-08-01', role: 'student' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts the tutor role', async () => {
    const dto = new OnboardingConsentDto();
    Object.assign(dto, { consent: true, policyVersion: '2026-08-01', role: 'tutor' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects the admin role (admin is never granted via public onboarding)', async () => {
    const dto = new OnboardingConsentDto();
    Object.assign(dto, { consent: true, policyVersion: '2026-08-01', role: 'admin' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('role');
  });

  it('rejects a policyVersion that is not a YYYY-MM-DD date', async () => {
    const dto = new OnboardingConsentDto();
    Object.assign(dto, { consent: true, policyVersion: 'x', role: 'student' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('policyVersion');
  });

  it('accepts the supported policy version from the server-owned allowlist', async () => {
    const dto = new OnboardingConsentDto();
    Object.assign(dto, { consent: true, policyVersion: '2026-08-01', role: 'student' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects an impossible calendar date that passes the shape-only regex', async () => {
    const dto = new OnboardingConsentDto();
    Object.assign(dto, { consent: true, policyVersion: '2026-99-99', role: 'student' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('policyVersion');
  });

  it('rejects an unknown future policy version', async () => {
    const dto = new OnboardingConsentDto();
    Object.assign(dto, { consent: true, policyVersion: '2027-01-01', role: 'student' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('policyVersion');
  });

  it('rejects an unknown older policy version', async () => {
    const dto = new OnboardingConsentDto();
    Object.assign(dto, { consent: true, policyVersion: '2026-07-15', role: 'student' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('policyVersion');
  });

  it('treats a declined consent as shape-valid (business rejection is the service\u2019s job)', async () => {
    const dto = new OnboardingConsentDto();
    Object.assign(dto, { consent: false, policyVersion: '2026-08-01', role: 'student' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
