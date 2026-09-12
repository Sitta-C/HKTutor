import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@/app.setup';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@/auth/auth.constants';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { PrismaService } from '@/database/prisma.service';
import { Role } from '@/generated/prisma/client';
import { ProfilesController } from '@/profiles/profiles.controller';
import { ProfilesService } from '@/profiles/profiles.service';

import type { AuthenticatedRequest, AuthenticatedUser } from '@/auth/auth.guard';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types';

const STUDENT_ID = '20000000-0000-4000-8000-000000000001';
const STALE_POLICY_VERSION = '2026-01-01';

const VALID_BODY = {
  firstName: 'Suda',
  gradeLevel: 'Grade 10',
  lastName: 'Dee',
  nickname: 'Da',
  phone: '0812345678',
  school: 'Demo School',
};

const studentRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  firstName: 'Suda',
  gradeLevel: 'Grade 10',
  lastName: 'Dee',
  nickname: 'Da',
  phone: '0812345678',
  school: 'Demo School',
  ...overrides,
});

interface UpsertArgs {
  create: { userId: string } & Record<string, unknown>;
  select: Record<string, unknown>;
  update: Record<string, unknown>;
  where: { userId: string };
}

interface ProfileReadBody {
  consentCurrent: boolean;
  profile: Record<string, unknown> | null;
  profileComplete: boolean;
  role: string;
}

interface ErrorBody {
  message: string | string[];
}

describe('Student profile contract (e2e)', () => {
  let app: INestApplication<App>;
  let currentUser: AuthenticatedUser;
  const userFindUnique = jest.fn();
  const studentUpsert = jest.fn();

  const lastUpsertArgs = (): UpsertArgs => {
    const calls = studentUpsert.mock.calls as unknown as unknown[][];
    return calls.at(-1)?.[0] as UpsertArgs;
  };

  const readBody = (body: unknown): ProfileReadBody => body as ProfileReadBody;

  const errorBody = (body: unknown): ErrorBody => body as ErrorBody;

  beforeAll(async () => {
    const prisma = {
      studentProfile: { upsert: studentUpsert },
      user: { findUnique: userFindUnique },
    };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ProfilesController],
      providers: [
        ProfilesService,
        // RolesGuard is registered but deliberately NOT overridden: the 403 cases must be
        // produced by the real role check against the @Roles metadata on the controller.
        RolesGuard,
        { provide: PrismaService, useValue: prisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
          req.auth = currentUser;
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    currentUser = {
      email: 'student@example.com',
      id: STUDENT_ID,
      role: Role.STUDENT,
      sessionId: 'session-id',
    };
  });

  describe('create and update', () => {
    it('creates the profile for the authenticated student through the upsert route', async () => {
      userFindUnique.mockResolvedValue({ policyVersion: CURRENT_PRIVACY_POLICY_VERSION });
      studentUpsert.mockResolvedValue(studentRow());

      const response = await request(app.getHttpServer())
        .put('/api/v1/profiles/me/student')
        .send(VALID_BODY)
        .expect(200);

      expect(response.body).toEqual(studentRow());

      const args = lastUpsertArgs();
      expect(args.create).toEqual({ userId: STUDENT_ID, ...VALID_BODY });
      expect(args.update).toEqual(VALID_BODY);
      expect(args.where).toEqual({ userId: STUDENT_ID });
      expect(Object.keys(args.select).sort()).toEqual([
        'firstName',
        'gradeLevel',
        'lastName',
        'nickname',
        'phone',
        'school',
      ]);
    });

    it('updates an existing profile with the same route and returns the stored values', async () => {
      userFindUnique.mockResolvedValue({ policyVersion: CURRENT_PRIVACY_POLICY_VERSION });
      studentUpsert.mockResolvedValue(studentRow({ nickname: 'Da-2', school: 'Updated School' }));

      const response = await request(app.getHttpServer())
        .put('/api/v1/profiles/me/student')
        .send({ ...VALID_BODY, nickname: 'Da-2', school: 'Updated School' })
        .expect(200);

      expect(response.body).toEqual(
        expect.objectContaining({ nickname: 'Da-2', school: 'Updated School' }),
      );
      expect(lastUpsertArgs().update).toEqual({
        ...VALID_BODY,
        nickname: 'Da-2',
        school: 'Updated School',
      });
    });

    it('uses the authenticated user id as the owner of the saved profile', async () => {
      userFindUnique.mockResolvedValue({ policyVersion: CURRENT_PRIVACY_POLICY_VERSION });
      studentUpsert.mockResolvedValue(studentRow());

      await request(app.getHttpServer())
        .put('/api/v1/profiles/me/student')
        .send(VALID_BODY)
        .expect(200);

      expect(lastUpsertArgs().create.userId).toBe(STUDENT_ID);
      expect(lastUpsertArgs().where).toEqual({ userId: STUDENT_ID });
    });
  });

  describe('validation', () => {
    const withoutFirstName = (): Record<string, unknown> => ({
      gradeLevel: VALID_BODY.gradeLevel,
      lastName: VALID_BODY.lastName,
      nickname: VALID_BODY.nickname,
      phone: VALID_BODY.phone,
      school: VALID_BODY.school,
    });

    const rejectedBodies: [string, Record<string, unknown>][] = [
      ['a body without firstName', withoutFirstName()],
      ['a whitespace-only school', { ...VALID_BODY, school: '   ' }],
      ['a phone below the documented pattern', { ...VALID_BODY, phone: '123' }],
      ['a firstName longer than 100 characters', { ...VALID_BODY, firstName: 'x'.repeat(101) }],
      ['a school longer than 160 characters', { ...VALID_BODY, school: 'x'.repeat(161) }],
      ['a gradeLevel longer than 80 characters', { ...VALID_BODY, gradeLevel: 'x'.repeat(81) }],
      ['an undeclared extra property', { ...VALID_BODY, userId: STUDENT_ID }],
    ];

    it.each(rejectedBodies)('returns 400 for %s', async (_label, body) => {
      userFindUnique.mockResolvedValue({ policyVersion: CURRENT_PRIVACY_POLICY_VERSION });

      const response = await request(app.getHttpServer())
        .put('/api/v1/profiles/me/student')
        .send(body)
        .expect(400);

      expect(errorBody(response.body).message).toBeDefined();
      expect(studentUpsert).not.toHaveBeenCalled();
    });
  });

  describe('access control', () => {
    it('returns 403 when a tutor calls the student profile route', async () => {
      currentUser = { ...currentUser, role: Role.TUTOR };

      await request(app.getHttpServer())
        .put('/api/v1/profiles/me/student')
        .send(VALID_BODY)
        .expect(403);

      expect(studentUpsert).not.toHaveBeenCalled();
    });

    it('returns 403 when an admin calls the student profile route', async () => {
      currentUser = { ...currentUser, role: Role.ADMIN };

      await request(app.getHttpServer())
        .put('/api/v1/profiles/me/student')
        .send(VALID_BODY)
        .expect(403);

      expect(studentUpsert).not.toHaveBeenCalled();
    });

    it('returns the caller role shape from the private read route', async () => {
      currentUser = { ...currentUser, role: Role.TUTOR };
      userFindUnique.mockResolvedValue({
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        tutorProfile: { bio: 'Maths tutor', displayName: 'Kru Anan', experienceYears: 5 },
      });

      const response = await request(app.getHttpServer()).get('/api/v1/profiles/me').expect(200);

      expect(readBody(response.body).role).toBe(Role.TUTOR);
      expect(readBody(response.body).profile).toEqual({
        bio: 'Maths tutor',
        displayName: 'Kru Anan',
        experienceYears: 5,
      });
    });

    it('returns 404 when the authenticated account no longer exists', async () => {
      userFindUnique.mockResolvedValue(null);

      await request(app.getHttpServer()).get('/api/v1/profiles/me').expect(404);
    });
  });

  describe('consent and privacy', () => {
    it('rejects a student profile write until the current notice is accepted', async () => {
      userFindUnique.mockResolvedValue({ policyVersion: STALE_POLICY_VERSION });

      const response = await request(app.getHttpServer())
        .put('/api/v1/profiles/me/student')
        .send(VALID_BODY)
        .expect(400);

      expect(errorBody(response.body).message).toBe(
        'Accept the current privacy notice before saving a profile',
      );
      expect(studentUpsert).not.toHaveBeenCalled();
    });

    it('rejects a private read and leaks no profile data until consent is current', async () => {
      userFindUnique.mockResolvedValue({
        policyVersion: STALE_POLICY_VERSION,
        studentProfile: studentRow(),
      });

      const response = await request(app.getHttpServer()).get('/api/v1/profiles/me').expect(400);

      expect(errorBody(response.body).message).toBe(
        'Accept the current privacy notice before viewing a profile',
      );
      expect(JSON.stringify(response.body)).not.toContain('0812345678');
    });

    it('reports consent and completeness for a consented student without a profile row', async () => {
      userFindUnique.mockResolvedValue({
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        studentProfile: null,
      });

      const response = await request(app.getHttpServer()).get('/api/v1/profiles/me').expect(200);

      expect(readBody(response.body)).toEqual({
        consentCurrent: true,
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        profile: null,
        profileComplete: false,
        role: Role.STUDENT,
      });
    });

    it('never returns private credential fields from the profile routes', async () => {
      userFindUnique.mockResolvedValue({
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        studentProfile: studentRow(),
      });
      studentUpsert.mockResolvedValue(studentRow());

      const readResponse = await request(app.getHttpServer())
        .get('/api/v1/profiles/me')
        .expect(200);
      const writeResponse = await request(app.getHttpServer())
        .put('/api/v1/profiles/me/student')
        .send(VALID_BODY)
        .expect(200);

      for (const response of [readResponse, writeResponse]) {
        expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|refreshToken/);
        expect(response.body).not.toHaveProperty('userId');
      }
      expect(readBody(readResponse.body).profileComplete).toBe(true);
    });
  });
});
