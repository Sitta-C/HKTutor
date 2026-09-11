import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { ResourceOwnershipGuard } from '@/auth/ownership.guard';
import { Role } from '@/generated/prisma/client';

import type { AuthenticatedRequest, AuthenticatedUser } from '@/auth/auth.guard';
import type { OwnershipRule } from '@/auth/ownership.decorator';
import type { PrismaService } from '@/database/prisma.service';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

const RESOURCE_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';

describe('ResourceOwnershipGuard', () => {
  const getAllAndOverride = jest.fn();
  const studentProfileFindFirst = jest.fn();
  const tutorProfileFindFirst = jest.fn();
  const teachingListingFindFirst = jest.fn();
  const availabilitySlotFindFirst = jest.fn();
  const bookingFindFirst = jest.fn();
  const prisma = {
    availabilitySlot: { findFirst: availabilitySlotFindFirst },
    booking: { findFirst: bookingFindFirst },
    studentProfile: { findFirst: studentProfileFindFirst },
    teachingListing: { findFirst: teachingListingFindFirst },
    tutorProfile: { findFirst: tutorProfileFindFirst },
  } as unknown as PrismaService;
  const guard = new ResourceOwnershipGuard({ getAllAndOverride } as unknown as Reflector, prisma);

  afterEach(() => jest.resetAllMocks());

  it('allows routes that do not declare an ownership rule', async () => {
    getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
  });

  it('requires authentication before checking ownership', async () => {
    ownershipRule({ resource: 'teachingListing' });

    await expect(guard.canActivate(createContext())).rejects.toThrow(
      new UnauthorizedException('Authentication is required before ownership authorization'),
    );
  });

  it('loads a tutor listing with the resource ID and owner in the same query', async () => {
    ownershipRule({ resource: 'teachingListing', idParam: 'listingId' });
    teachingListingFindFirst.mockResolvedValue({ id: RESOURCE_ID });

    await expect(
      guard.canActivate(createContext(authenticatedUser(Role.TUTOR), { listingId: RESOURCE_ID })),
    ).resolves.toBe(true);
    expect(teachingListingFindFirst).toHaveBeenCalledWith({
      where: { id: RESOURCE_ID, deletedAt: null, tutorProfileId: USER_ID },
      select: { id: true },
    });
  });

  it('allows a student to load their own student profile', async () => {
    ownershipRule({ resource: 'studentProfile', idParam: 'userId' });
    studentProfileFindFirst.mockResolvedValue({ userId: USER_ID });

    await expect(
      guard.canActivate(createContext(authenticatedUser(Role.STUDENT), { userId: USER_ID })),
    ).resolves.toBe(true);
    expect(studentProfileFindFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      select: { userId: true },
    });
  });

  it("rejects another user's student profile without querying it", async () => {
    ownershipRule({ resource: 'studentProfile', idParam: 'userId' });

    await expect(
      guard.canActivate(createContext(authenticatedUser(Role.STUDENT), { userId: RESOURCE_ID })),
    ).rejects.toThrow(new NotFoundException('Resource not found'));
    expect(studentProfileFindFirst).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_UUID for a malformed ID without querying the resource', async () => {
    ownershipRule({ resource: 'availabilitySlot', idParam: 'slotId' });
    await expect(
      guard.canActivate(createContext(authenticatedUser(Role.TUTOR), { slotId: 'not-a-uuid' })),
    ).rejects.toMatchObject(
      new BadRequestException({
        code: 'INVALID_UUID',
        error: 'Bad Request',
        message: 'slotId must be a valid UUID',
        statusCode: 400,
      }),
    );
    expect(availabilitySlotFindFirst).not.toHaveBeenCalled();
  });

  it('returns the same generic 404 for a missing record and another owner', async () => {
    ownershipRule({ resource: 'availabilitySlot', idParam: 'slotId' });
    availabilitySlotFindFirst.mockResolvedValue(null);

    await expect(
      guard.canActivate(createContext(authenticatedUser(Role.TUTOR), { slotId: RESOURCE_ID })),
    ).rejects.toThrow(new NotFoundException('Resource not found'));
  });

  it.each([
    [Role.STUDENT, { studentUserId: USER_ID }],
    [Role.TUTOR, { tutorProfileId: USER_ID }],
  ])('scopes booking access for %s ownership', async (role, ownerFilter) => {
    ownershipRule({ resource: 'booking', idParam: 'bookingId' });
    bookingFindFirst.mockResolvedValue({ id: RESOURCE_ID });

    await expect(
      guard.canActivate(createContext(authenticatedUser(role), { bookingId: RESOURCE_ID })),
    ).resolves.toBe(true);
    expect(bookingFindFirst).toHaveBeenCalledWith({
      where: { id: RESOURCE_ID, ...ownerFilter },
      select: { id: true },
    });
  });

  it('allows an explicitly authorized admin to load the resource without an owner filter', async () => {
    ownershipRule({ resource: 'teachingListing', allowAdmin: true });
    teachingListingFindFirst.mockResolvedValue({ id: RESOURCE_ID });

    await expect(
      guard.canActivate(createContext(authenticatedUser(Role.ADMIN), { id: RESOURCE_ID })),
    ).resolves.toBe(true);
    expect(teachingListingFindFirst).toHaveBeenCalledWith({
      where: { id: RESOURCE_ID, deletedAt: null },
      select: { id: true },
    });
  });

  function ownershipRule(rule: OwnershipRule): void {
    getAllAndOverride.mockReturnValue(rule);
  }
});

function authenticatedUser(role: Role): AuthenticatedUser {
  return {
    email: 'user@example.com',
    id: USER_ID,
    role,
    sessionId: 'session-id',
  };
}

function createContext(
  auth?: AuthenticatedUser,
  params: Record<string, string> = {},
): ExecutionContext {
  const request = { auth, params } as unknown as AuthenticatedRequest;

  return {
    getClass: () => class TestController {},
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}
