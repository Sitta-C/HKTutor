import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { CatalogController } from '@/tutors/catalog.controller';
import { PublicTutorsController } from '@/tutors/public-tutors.controller';

import type { TutorsService } from '@/tutors/tutors.service';

describe('public Tutor controllers', () => {
  it('are plain public controllers without authentication guards', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PublicTutorsController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, CatalogController)).toBeUndefined();
    expect(Reflect.getMetadata(PATH_METADATA, PublicTutorsController)).toBe('tutors');
    expect(Reflect.getMetadata(PATH_METADATA, CatalogController)).toBe('/');
  });

  it('delegates public Tutor search and detail without a user argument', async () => {
    const service = {
      getPublicTutor: jest.fn(),
      searchPublicTutors: jest.fn(),
    };
    const controller = new PublicTutorsController(service as unknown as TutorsService);
    const query = { maxPrice: 500 };
    const results = [{ listingId: 'listing', tutorId: 'tutor' }];
    const detail = { listings: [], tutor: { tutorId: 'tutor' } };
    service.searchPublicTutors.mockResolvedValue(results);
    service.getPublicTutor.mockResolvedValue(detail);

    await expect(controller.search(query)).resolves.toBe(results);
    await expect(controller.getPublicTutor('tutor')).resolves.toBe(detail);
    expect(service.searchPublicTutors).toHaveBeenCalledWith(query);
    expect(service.getPublicTutor).toHaveBeenCalledWith('tutor');
  });

  it('delegates both catalogs to the public catalog service methods', async () => {
    const service = {
      getActiveGradeLevels: jest.fn().mockResolvedValue({ items: [] }),
      getActiveSubjects: jest.fn().mockResolvedValue({ items: [] }),
    };
    const controller = new CatalogController(service as unknown as TutorsService);

    await expect(controller.getSubjects()).resolves.toEqual({ items: [] });
    await expect(controller.getGradeLevels()).resolves.toEqual({ items: [] });
    expect(service.getActiveSubjects).toHaveBeenCalledTimes(1);
    expect(service.getActiveGradeLevels).toHaveBeenCalledTimes(1);
  });
});
