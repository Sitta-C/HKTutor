import { ROLES_KEY } from '@/auth/roles.decorator';
import { Role } from '@/generated/prisma/client';
import { ProfilesController } from '@/profiles/profiles.controller';

import type { AuthenticatedUser } from '@/auth/auth.guard';
import type { ProfilesService } from '@/profiles/profiles.service';

describe('ProfilesController', () => {
  it('uses the authenticated student id as the upsert owner', async () => {
    const profile = {
      firstName: 'Suda',
      lastName: 'Dee',
      nickname: 'Da',
      school: 'Demo School',
      gradeLevel: 'Grade 10',
      phone: '0812345678',
    };
    const saveStudent = jest.fn().mockResolvedValue(profile);
    const controller = new ProfilesController({ saveStudent } as unknown as ProfilesService);
    const user: AuthenticatedUser = {
      id: 'student-id',
      email: 'student@example.com',
      role: Role.STUDENT,
      sessionId: 'session-id',
    };

    await expect(controller.saveStudent(user, profile)).resolves.toEqual(profile);
    expect(saveStudent).toHaveBeenCalledWith('student-id', profile);
  });

  it('restricts the student upsert route to the student role', () => {
    const handler = Object.getOwnPropertyDescriptor(ProfilesController.prototype, 'saveStudent')
      ?.value as object | undefined;
    const roles = handler
      ? (Reflect.getMetadata(ROLES_KEY, handler) as Role[] | undefined)
      : undefined;

    expect(roles).toEqual([Role.STUDENT]);
  });
});
