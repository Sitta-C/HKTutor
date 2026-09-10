import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { OWNERSHIP_KEY } from '@/auth/ownership.decorator';
import { PrismaService } from '@/database/prisma.service';
import { Role } from '@/generated/prisma/client';

import type { AuthenticatedRequest, AuthenticatedUser } from '@/auth/auth.guard';
import type { OwnershipRule } from '@/auth/ownership.decorator';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCE_NOT_FOUND = 'Resource not found';

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
    if (typeof resourceId !== 'string' || !UUID_PATTERN.test(resourceId)) {
      throw new BadRequestException({
        code: 'INVALID_UUID',
        error: 'Bad Request',
        message: `${rule.idParam ?? 'id'} must be a valid UUID`,
        statusCode: 400,
      });
    }

    if (!(await this.canAccess(rule, resourceId, request.auth))) {
      throw new NotFoundException(RESOURCE_NOT_FOUND);
    }

    return true;
  }

  private async canAccess(
    rule: OwnershipRule,
    resourceId: string,
    user: AuthenticatedUser,
  ): Promise<boolean> {
    const adminAccess = rule.allowAdmin === true && user.role === Role.ADMIN;

    switch (rule.resource) {
      case 'studentProfile':
        if (!adminAccess && resourceId !== user.id) return false;

        return Boolean(
          await this.prisma.studentProfile.findFirst({
            where: { userId: resourceId },
            select: { userId: true },
          }),
        );
      case 'tutorProfile':
        if (!adminAccess && resourceId !== user.id) return false;

        return Boolean(
          await this.prisma.tutorProfile.findFirst({
            where: { userId: resourceId },
            select: { userId: true },
          }),
        );
      case 'teachingListing':
        return Boolean(
          await this.prisma.teachingListing.findFirst({
            where: {
              id: resourceId,
              deletedAt: null,
              ...(adminAccess ? {} : { tutorProfileId: user.id }),
            },
            select: { id: true },
          }),
        );
      case 'availabilitySlot':
        return Boolean(
          await this.prisma.availabilitySlot.findFirst({
            where: {
              id: resourceId,
              deletedAt: null,
              ...(adminAccess ? {} : { tutorProfileId: user.id }),
            },
            select: { id: true },
          }),
        );
      case 'booking':
        return this.canAccessBooking(resourceId, user, adminAccess);
    }
  }

  private async canAccessBooking(
    resourceId: string,
    user: AuthenticatedUser,
    adminAccess: boolean,
  ): Promise<boolean> {
    if (!adminAccess && user.role !== Role.STUDENT && user.role !== Role.TUTOR) return false;

    return Boolean(
      await this.prisma.booking.findFirst({
        where: {
          id: resourceId,
          ...(adminAccess
            ? {}
            : user.role === Role.STUDENT
              ? { studentUserId: user.id }
              : { tutorProfileId: user.id }),
        },
        select: { id: true },
      }),
    );
  }
}
