import { OWNERSHIP_KEY } from '@/auth/ownership.decorator';
import { ROLES_KEY } from '@/auth/roles.decorator';
import { Role } from '@/generated/prisma/client';
import { TutorsController } from '@/tutors/tutors.controller';

import type { AuthenticatedUser } from '@/auth/auth.guard';
import type { OwnershipRule } from '@/auth/ownership.decorator';
import type { ListingResponseDto } from '@/tutors/tutors.dto';
import type { TutorsService } from '@/tutors/tutors.service';

const USER_ID = '20000000-0000-4000-8000-000000000001';
const LISTING_ID = '10000000-0000-4000-8000-000000000001';
const user: AuthenticatedUser = {
  email: 'tutor@example.com',
  id: USER_ID,
  role: Role.TUTOR,
  sessionId: 'session-id',
};

function createController() {
  const service = {
    getListings: jest.fn(),
    patchListing: jest.fn(),
    postListing: jest.fn(),
    postPublishListing: jest.fn(),
  };

  return {
    controller: new TutorsController(service as unknown as TutorsService),
    service,
  };
}

describe('TutorsController', () => {
  it('requires the tutor role at controller level', () => {
    expect(Reflect.getMetadata(ROLES_KEY, TutorsController)).toEqual([Role.TUTOR]);
  });

  it.each([
    ['patchListing', 'listingId'],
    ['postPublishListing', 'listingId'],
  ])('declares ownership protection on %s', (methodName, idParam) => {
    const handler = Object.getOwnPropertyDescriptor(TutorsController.prototype, methodName)
      ?.value as object | undefined;
    const ownership = handler
      ? (Reflect.getMetadata(OWNERSHIP_KEY, handler) as OwnershipRule | undefined)
      : undefined;

    expect(ownership).toEqual({
      allowAdmin: true,
      idParam,
      resource: 'teachingListing',
    });
  });

  it('passes the authenticated user id and query to the service', async () => {
    const { controller, service } = createController();
    const response = [{ listingId: LISTING_ID }] as ListingResponseDto[];
    service.getListings.mockResolvedValue(response);

    await expect(controller.getListings(user, { publicationStatus: 'DRAFT' })).resolves.toBe(
      response,
    );
    expect(service.getListings).toHaveBeenCalledWith(USER_ID, { publicationStatus: 'DRAFT' });
  });

  it('creates a listing using the authenticated user as owner', async () => {
    const { controller, service } = createController();
    const dto = {
      description: 'Experienced mathematics tutor.',
      gradeLevelId: '40000000-0000-4000-8000-000000000001',
      pricePerHour: 450,
      subjectId: '30000000-0000-4000-8000-000000000001',
    };
    const response = { listingId: LISTING_ID } as ListingResponseDto;
    service.postListing.mockResolvedValue(response);

    await expect(controller.postListing(user, dto)).resolves.toBe(response);
    expect(service.postListing).toHaveBeenCalledWith(USER_ID, dto);
  });

  it('patches an owned listing through the service', async () => {
    const { controller, service } = createController();
    const dto = { pricePerHour: 500 };
    const response = { listingId: LISTING_ID } as ListingResponseDto;
    service.patchListing.mockResolvedValue(response);

    await expect(controller.patchListing(user, LISTING_ID, dto)).resolves.toBe(response);
    expect(service.patchListing).toHaveBeenCalledWith(USER_ID, LISTING_ID, dto);
  });

  it('returns the published listing from the service', async () => {
    const { controller, service } = createController();
    const response = { listingId: LISTING_ID } as ListingResponseDto;
    service.postPublishListing.mockResolvedValue(response);

    await expect(controller.postPublishListing(user, LISTING_ID)).resolves.toBe(response);
    expect(service.postPublishListing).toHaveBeenCalledWith(USER_ID, LISTING_ID);
  });
});
