import { BadRequestException } from '@nestjs/common';

import { OWNERSHIP_KEY } from '@/auth/ownership.decorator';
import { ROLES_KEY } from '@/auth/roles.decorator';
import { Role } from '@/generated/prisma/client';
import { TutorsController } from '@/tutors/tutors.controller';

import type { OwnershipRule } from '@/auth/ownership.decorator';
import type { ListingResponseDto } from '@/tutors/tutors.dto';
import type { TutorsService } from '@/tutors/tutors.service';

const USER_ID = '20000000-0000-4000-8000-000000000001';
const LISTING_ID = '10000000-0000-4000-8000-000000000001';
const USER = {
  id: USER_ID,
  email: 'tutor@example.com',
  role: Role.TUTOR,
  sessionId: 'session-id',
};

function createController() {
  const service = {
    getListings: jest.fn(),
    getListing: jest.fn(),
    postListing: jest.fn(),
    patchListing: jest.fn(),
    postPublishListing: jest.fn(),
    updateListingStatus: jest.fn(),
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
    ['getListing', 'listingId'],
    ['patchListing', 'listingId'],
    ['postPublishListing', 'listingId'],
    ['updateListingStatus', 'listingId'],
  ])('declares ownership protection on %s', (methodName, idParam) => {
    const handler = Object.getOwnPropertyDescriptor(TutorsController.prototype, methodName)
      ?.value as object | undefined;
    const ownership = handler
      ? (Reflect.getMetadata(OWNERSHIP_KEY, handler) as OwnershipRule | undefined)
      : undefined;

    expect(ownership).toEqual({
      resource: 'teachingListing',
      idParam,
      allowAdmin: true,
    });
  });

  it('returns listings from the service and normalizes a null result to an empty array', async () => {
    const { controller, service } = createController();
    service.getListings
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([{ listingId: LISTING_ID }]);

    await expect(controller.getListings(USER, {})).resolves.toEqual([]);
    await expect(controller.getListings(USER, { publicationStatus: 'DRAFT' })).resolves.toEqual([
      { listingId: LISTING_ID },
    ]);
    expect(service.getListings).toHaveBeenNthCalledWith(1, USER_ID, {});
    expect(service.getListings).toHaveBeenNthCalledWith(2, USER_ID, {
      publicationStatus: 'DRAFT',
    });
  });

  it('returns one owned listing through the service', async () => {
    const { controller, service } = createController();
    const response = { listingId: LISTING_ID } as ListingResponseDto;
    service.getListing.mockResolvedValue(response);

    await expect(controller.getListing(USER, LISTING_ID)).resolves.toBe(response);
    expect(service.getListing).toHaveBeenCalledWith(USER_ID, LISTING_ID);
  });

  it('creates a listing through the service', async () => {
    const { controller, service } = createController();
    const request = {
      subjectId: 'subject-id',
      gradeLevelId: 'grade-id',
      pricePerHour: 450,
      description: 'Experienced mathematics tutor.',
    };
    service.postListing.mockResolvedValue(LISTING_ID);

    await expect(controller.postListing(USER, request)).resolves.toBe(LISTING_ID);
    expect(service.postListing).toHaveBeenCalledWith(USER_ID, request);
  });

  it('patches an owned listing through the service', async () => {
    const { controller, service } = createController();
    const request = { pricePerHour: 500 };
    const response = { listingId: LISTING_ID } as ListingResponseDto;
    service.patchListing.mockResolvedValue(response);

    await expect(controller.patchListing(USER, LISTING_ID, request)).resolves.toBe(response);
    expect(service.patchListing).toHaveBeenCalledWith(USER_ID, LISTING_ID, request);
  });

  it('publishes an owned listing and returns no response body', async () => {
    const { controller, service } = createController();
    service.postPublishListing.mockResolvedValue({ listingId: LISTING_ID });

    await expect(controller.postPublishListing(USER, LISTING_ID)).resolves.toBeUndefined();
    expect(service.postPublishListing).toHaveBeenCalledWith(USER_ID, LISTING_ID);
  });

  it('updates listing publication status through the service', async () => {
    const { controller, service } = createController();
    const response = { listingId: LISTING_ID, publicationStatus: 'ARCHIVED' } as ListingResponseDto;
    service.updateListingStatus.mockResolvedValue(response);

    await expect(
      controller.updateListingStatus(USER, LISTING_ID, { publicationStatus: 'ARCHIVED' }),
    ).resolves.toBe(response);
    expect(service.updateListingStatus).toHaveBeenCalledWith(USER_ID, LISTING_ID, 'ARCHIVED');
  });

  it.each([
    ['getListing', (controller: TutorsController) => controller.getListing(USER, '')],
    ['patchListing', (controller: TutorsController) => controller.patchListing(USER, '', {})],
    [
      'postPublishListing',
      (controller: TutorsController) => controller.postPublishListing(USER, ''),
    ],
    [
      'updateListingStatus',
      (controller: TutorsController) =>
        controller.updateListingStatus(USER, '', { publicationStatus: 'ARCHIVED' }),
    ],
  ])('%s rejects a missing listing id before calling the service', async (_name, invoke) => {
    const { controller, service } = createController();

    await expect(invoke(controller)).rejects.toThrow(new BadRequestException('listingId missing'));
    expect(service.getListing).not.toHaveBeenCalled();
    expect(service.patchListing).not.toHaveBeenCalled();
    expect(service.postPublishListing).not.toHaveBeenCalled();
    expect(service.updateListingStatus).not.toHaveBeenCalled();
  });
});
