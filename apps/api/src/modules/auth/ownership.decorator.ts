import { SetMetadata } from '@nestjs/common';

export const OWNERSHIP_KEY = 'auth:ownership';

export type OwnedResource =
  'availabilitySlot' | 'booking' | 'studentProfile' | 'teachingListing' | 'tutorProfile';

/** Body the guard answers with for one ownership outcome, so a route keeps its documented code. */
export interface OwnershipError {
  code: string;
  message: string;
}

export interface OwnershipRule {
  resource: OwnedResource;
  idParam?: string;
  allowAdmin?: boolean;
  /**
   * A resource owned by someone else is hidden behind the same generic 404 as a missing one unless
   * a route opts out here. Routes whose contract has to tell the two apart pass `errors`: the guard
   * then answers 403 with `foreignOwner` and keeps a domain-specific 404 body for `missing`.
   *
   * Only `booking`, `studentProfile` and `tutorProfile` can distinguish the two outcomes; listing
   * and availability-slot rules always report a missing resource.
   */
  errors?: {
    foreignOwner?: OwnershipError;
    missing?: OwnershipError;
  };
}

export const RequireOwnership = (rule: OwnershipRule) => SetMetadata(OWNERSHIP_KEY, rule);
