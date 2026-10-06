import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { invalidUuidException, isUuid } from '@common/pipes/uuid-param.pipe';
import { Role } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { OWNERSHIP_KEY } from '@modules/auth/ownership.decorator';

import type { AuthenticatedRequest, AuthenticatedUser } from '@modules/auth/auth.guard';
import type { OwnershipError, OwnershipRule } from '@modules/auth/ownership.decorator';

const RESOURCE_NOT_FOUND = 'Resource not found';

/**
 * `foreignOwner` means the record exists but belongs to somebody else. It collapses into the same
 * 404 as `missing` unless the route declares `errors.foreignOwner`.
 */
type OwnershipOutcome = 'foreignOwner' | 'granted' | 'missing';

@Injectable()
export class ResourceOwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<OwnershipRule>(OWNERSHIP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!rule) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw new UnauthorizedException('Authentication is required before ownership authorization');
    }

    const resourceId = request.params[rule.idParam ?? 'id'];
    if (!isUuid(resourceId)) throw invalidUuidException(rule.idParam ?? 'id');

    const outcome = await this.resolveOwnership(rule, resourceId, request.auth);
    if (outcome === 'granted') return true;

    if (outcome === 'foreignOwner' && rule.errors?.foreignOwner) {
      throw new ForbiddenException(errorBody(rule.errors.foreignOwner, 'Forbidden', 403));
    }

    const missing = rule.errors?.missing;
    throw new NotFoundException(
      missing ? errorBody(missing, 'Not Found', 404) : RESOURCE_NOT_FOUND,
    );
  }

  private async resolveOwnership(
    rule: OwnershipRule,
    resourceId: string,
    user: AuthenticatedUser,
  ): Promise<OwnershipOutcome> {
    const adminAccess = rule.allowAdmin === true && user.role === Role.ADMIN;

    switch (rule.resource) {
      case 'studentProfile':
        if (!adminAccess && resourceId !== user.id) return 'foreignOwner';

        return (await this.prisma.studentProfile.findFirst({
          where: { userId: resourceId },
          select: { userId: true },
        }))
          ? 'granted'
          : 'missing';
      case 'tutorProfile':
        if (!adminAccess && resourceId !== user.id) return 'foreignOwner';

        return (await this.prisma.tutorProfile.findFirst({
          where: { userId: resourceId },
          select: { userId: true },
        }))
          ? 'granted'
          : 'missing';
      case 'teachingListing':
        // One owner-scoped query cannot separate a foreign listing from a missing one.
        return (await this.prisma.teachingListing.findFirst({
          where: {
            id: resourceId,
            deletedAt: null,
            ...(adminAccess ? {} : { tutorProfileId: user.id }),
          },
          select: { id: true },
        }))
          ? 'granted'
          : 'missing';
      case 'availabilitySlot':
        return (await this.prisma.availabilitySlot.findFirst({
          where: {
            id: resourceId,
            deletedAt: null,
            ...(adminAccess ? {} : { tutorProfileId: user.id }),
          },
          select: { id: true },
        }))
          ? 'granted'
          : 'missing';
      case 'booking':
        return this.resolveBookingOwnership(resourceId, user, adminAccess);
      case 'tutorDocument': {
        const document = await this.prisma.tutorDocument.findFirst({
          where: {
            id: resourceId,
            tutor: { user: { deletedAt: null, accountStatus: 'ACTIVE', role: Role.TUTOR } },
          },
          select: { tutorUserId: true },
        });
        if (!document) {
          return 'missing';
        }
        return adminAccess || (user.role === Role.TUTOR && document.tutorUserId === user.id)
          ? 'granted'
          : 'foreignOwner';
      }
    }
  }

  private async resolveBookingOwnership(
    resourceId: string,
    user: AuthenticatedUser,
    adminAccess: boolean,
  ): Promise<OwnershipOutcome> {
    if (!adminAccess && user.role !== Role.STUDENT && user.role !== Role.TUTOR) {
      return 'foreignOwner';
    }

    // Loaded without an owner filter so a foreign booking can be told apart from a missing one.
    const booking = await this.prisma.booking.findUnique({
      where: { id: resourceId },
      select: { studentUserId: true, tutorProfileId: true },
    });

    if (!booking) return 'missing';
    if (adminAccess) return 'granted';

    const ownerId = user.role === Role.STUDENT ? booking.studentUserId : booking.tutorProfileId;
    return ownerId === user.id ? 'granted' : 'foreignOwner';
  }
}

function errorBody(
  error: OwnershipError,
  reason: string,
  statusCode: number,
): { code: string; error: string; message: string; statusCode: number } {
  return { code: error.code, error: reason, message: error.message, statusCode };
}
