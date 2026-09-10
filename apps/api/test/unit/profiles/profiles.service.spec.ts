import { BadRequestException } from '@nestjs/common';

import { CURRENT_PRIVACY_POLICY_VERSION } from '@/auth/auth.constants';
import { Role } from '@/generated/prisma/client';
import { ProfilesService } from '@/profiles/profiles.service';

import type { PrismaService } from '@/database/prisma.service';

describe('ProfilesService', () => {
  it('reports a student profile complete only when its private profile row exists', async () => {
    const profile = {
      firstName: 'Suda',
      lastName: 'Dee',
      nickname: 'Da',
      school: 'Demo School',
      gradeLevel: 'Grade 10',
      phone: '0812345678',
    };
    const service = new ProfilesService({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
          studentProfile: profile,
          tutorProfile: null,
        }),
      },
    } as unknown as PrismaService);

    await expect(
      service.getMine({
        id: 'student-id',
        email: 'student@example.com',
        role: Role.STUDENT,
        sessionId: 'session-id',
      }),
    ).resolves.toMatchObject({
      consentCurrent: true,
      profile,
      profileComplete: true,
      role: Role.STUDENT,
    });
  });

  it('returns tutor profile lifecycle metadata with the editable profile', async () => {
    const createdAt = new Date('2026-08-01T00:00:00.000Z');
    const updatedAt = new Date('2026-08-02T00:00:00.000Z');
    const tutorProfile = {
      firstName: 'Anan',
      lastName: 'Sukjai',
      nickname: 'Anan',
      displayName: 'Kru Anan',
      bio: 'Mathematics tutor',
      experienceYears: 5,
      verificationStatus: 'VERIFIED',
      ratingAverage: 4.8,
      reviewCount: 24,
      createdAt,
      updatedAt,
    };
    let profileQuery: unknown;
    const findUnique = jest.fn().mockImplementation((query: unknown) => {
      profileQuery = query;
      return Promise.resolve({
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        studentProfile: null,
        tutorProfile,
      });
    });
    const service = new ProfilesService({ user: { findUnique } } as unknown as PrismaService);

    await expect(
      service.getMine({
        id: 'tutor-id',
        email: 'tutor@example.com',
        role: Role.TUTOR,
        sessionId: 'session-id',
      }),
    ).resolves.toMatchObject({
      profile: { createdAt, updatedAt },
      profileComplete: true,
      role: Role.TUTOR,
    });

    const typedProfileQuery = profileQuery as {
      select?: {
        tutorProfile?: {
          select?: { createdAt?: boolean; updatedAt?: boolean };
        };
      };
    };
    expect(typedProfileQuery.select?.tutorProfile?.select).toMatchObject({
      createdAt: true,
      updatedAt: true,
    });
  });

  it('blocks profile writes until the current notice has been accepted', async () => {
    const studentUpsert = jest.fn();
    const service = new ProfilesService({
      user: { findUnique: jest.fn().mockResolvedValue({ policyVersion: '2026-09-08' }) },
      studentProfile: { upsert: studentUpsert },
    } as unknown as PrismaService);

    await expect(
      service.saveStudent('student-id', {
        firstName: 'Suda',
        lastName: 'Dee',
        nickname: 'Da',
        school: 'Demo School',
        gradeLevel: 'Grade 10',
        phone: '0812345678',
      }),
    ).rejects.toThrow(
      new BadRequestException('Accept the current privacy notice before saving a profile'),
    );
    expect(studentUpsert).not.toHaveBeenCalled();
  });

  it('does not return a private profile until the current notice has been accepted', async () => {
    const service = new ProfilesService({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          policyVersion: '2026-09-08',
          studentProfile: {
            firstName: 'Suda',
            lastName: 'Dee',
            nickname: 'Da',
            school: 'Demo School',
            gradeLevel: 'Grade 10',
            phone: '0812345678',
          },
          tutorProfile: null,
        }),
      },
    } as unknown as PrismaService);

    await expect(
      service.getMine({
        id: 'student-id',
        email: 'student@example.com',
        role: Role.STUDENT,
        sessionId: 'session-id',
      }),
    ).rejects.toThrow(
      new BadRequestException('Accept the current privacy notice before viewing a profile'),
    );
  });

  it('upserts a student profile under the authenticated user id', async () => {
    const input = {
      firstName: 'Suda',
      lastName: 'Dee',
      nickname: 'Da',
      school: 'Demo School',
      gradeLevel: 'Grade 10',
      phone: '0812345678',
    };
    const studentUpsert = jest.fn().mockResolvedValue(input);
    const service = new ProfilesService({
      user: {
        findUnique: jest.fn().mockResolvedValue({ policyVersion: CURRENT_PRIVACY_POLICY_VERSION }),
      },
      studentProfile: { upsert: studentUpsert },
    } as unknown as PrismaService);

    await expect(service.saveStudent('student-id', input)).resolves.toEqual(input);
    expect(studentUpsert).toHaveBeenCalledWith({
      where: { userId: 'student-id' },
      update: input,
      create: { userId: 'student-id', ...input },
      select: {
        firstName: true,
        gradeLevel: true,
        lastName: true,
        nickname: true,
        phone: true,
        school: true,
      },
    });
  });

  it('upserts only tutor-editable fields while server-controlled review fields remain untouched', async () => {
    const tutorUpsert = jest.fn().mockResolvedValue({ displayName: 'Kru Anan' });
    const service = new ProfilesService({
      user: {
        findUnique: jest.fn().mockResolvedValue({ policyVersion: CURRENT_PRIVACY_POLICY_VERSION }),
      },
      tutorProfile: { upsert: tutorUpsert },
    } as unknown as PrismaService);
    const input = {
      firstName: 'Anan',
      lastName: 'Sukjai',
      nickname: 'Anan',
      displayName: 'Kru Anan',
      bio: 'Mathematics tutor',
      experienceYears: 5,
    };

    await service.saveTutor('tutor-id', input);

    expect(tutorUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'tutor-id' },
        update: input,
        create: { userId: 'tutor-id', ...input },
      }),
    );
    const calls = tutorUpsert.mock.calls as unknown as Array<[{ update: Record<string, unknown> }]>;
    expect(calls[0]?.[0].update).not.toHaveProperty('verificationStatus');
    expect(calls[0]?.[0].update).not.toHaveProperty('ratingAverage');
  });
});
