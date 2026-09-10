import { SetMetadata } from '@nestjs/common';

export const OWNERSHIP_KEY = 'auth:ownership';

export type OwnedResource =
  'availabilitySlot' | 'booking' | 'studentProfile' | 'teachingListing' | 'tutorProfile';

export interface OwnershipRule {
  resource: OwnedResource;
  idParam?: string;
  allowAdmin?: boolean;
}

export const RequireOwnership = (rule: OwnershipRule) => SetMetadata(OWNERSHIP_KEY, rule);
