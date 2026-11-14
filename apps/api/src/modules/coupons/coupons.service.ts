import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@generated/prisma/client';
import { CouponReservationStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { decodeCouponCursor, encodeCouponCursor } from '@modules/coupons/coupons.cursor';
import { DEFAULT_COUPON_LIMIT } from '@modules/coupons/coupons.dto';

import type { CreateCouponDto, ListCouponsQueryDto } from '@modules/coupons/coupons.dto';
import type { CouponDto, CouponListDto } from '@modules/coupons/coupons.swagger';

const couponSelect = {
  id: true,
  code: true,
  percent: true,
  expiresAt: true,
  maxUses: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      uses: true,
      reservations: { where: { status: CouponReservationStatus.RESERVED } },
    },
  },
} satisfies Prisma.CouponSelect;

type CouponRecord = Prisma.CouponGetPayload<{ select: typeof couponSelect }>;

function isCouponCodeConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target: unknown = error.meta?.['target'];
  if (Array.isArray(target) && target.includes('code')) {
    return true;
  }
  // Prisma's PostgreSQL adapter reports the index instead of a target field list. Match the
  // specific coupon index so an AuditLog uniqueness failure is never disguised as a code clash.
  const adapter: unknown = error.meta?.['driverAdapterError'];
  if (!adapter || typeof adapter !== 'object' || !('cause' in adapter)) {
    return false;
  }
  const cause: unknown = adapter.cause;
  if (!cause || typeof cause !== 'object' || !('constraint' in cause)) {
    return false;
  }
  const constraint: unknown = cause.constraint;
  return (
    !!constraint &&
    typeof constraint === 'object' &&
    'index' in constraint &&
    constraint.index === 'Coupon_code_key'
  );
}

function toCouponDto(coupon: CouponRecord): CouponDto {
  return {
    id: coupon.id,
    code: coupon.code,
    percent: coupon.percent,
    expiresAt: coupon.expiresAt.toISOString(),
    maxUses: coupon.maxUses,
    active: coupon.active,
    consumedUses: coupon._count.uses,
    reservedUses: coupon._count.reservations,
    availableUses: coupon.maxUses - coupon._count.uses - coupon._count.reservations,
    createdAt: coupon.createdAt.toISOString(),
    updatedAt: coupon.updatedAt.toISOString(),
  };
}

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(actorUserId: string, dto: CreateCouponDto): Promise<CouponDto> {
    const expiresAt = new Date(dto.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be strictly in the future');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        // DB02's insert trigger writes the sole coupon.create audit event. Local context binds
        // its actor to this request and cannot leak through the shared connection pool.
        await tx.$queryRaw`SELECT set_config('hktutor.audit_actor_user_id', ${actorUserId}, true)`;
        if (expiresAt.getTime() <= Date.now()) {
          throw new BadRequestException('expiresAt must be strictly in the future');
        }
        const coupon = await tx.coupon.create({
          data: {
            code: dto.code.trim().toUpperCase(),
            percent: dto.percent,
            expiresAt,
            maxUses: dto.maxUses,
            active: dto.active ?? true,
          },
          select: couponSelect,
        });
        return toCouponDto(coupon);
      });
    } catch (error) {
      if (isCouponCodeConflict(error)) {
        throw new ConflictException({
          code: 'COUPON_CODE_EXISTS',
          message: 'A coupon with this code already exists',
        });
      }
      throw error;
    }
  }

  async setActivation(actorUserId: string, couponId: string, active: boolean): Promise<CouponDto> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize desired-state writes with each other and the payment capacity claim.
      await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "id" = ${couponId}::uuid FOR UPDATE`;
      const before = await tx.coupon.findUnique({ where: { id: couponId }, select: couponSelect });
      if (!before) {
        throw new NotFoundException('Coupon not found');
      }
      if (before.active === active) {
        return toCouponDto(before);
      }
      const coupon = await tx.coupon.update({
        where: { id: couponId },
        data: { active },
        select: couponSelect,
      });
      const auditId = randomUUID();
      await tx.auditLog.create({
        data: {
          id: auditId,
          actorUserId,
          action: 'coupon.active_change',
          entityType: 'Coupon',
          entityId: couponId,
          beforeData: { active: before.active },
          afterData: { active },
          operationKey: `coupon.active_change:${auditId}`,
        },
        select: { id: true },
      });
      return toCouponDto(coupon);
    });
  }

  async list(query: ListCouponsQueryDto): Promise<CouponListDto> {
    const cursor = query.cursor ? decodeCouponCursor(query.cursor) : undefined;
    const limit = query.limit ?? DEFAULT_COUPON_LIMIT;
    // A shared snapshot keeps the page metadata and both counts coherent even if the ORM
    // performs relation reads separately while a payment consumes a reservation.
    return this.prisma.$transaction(
      async (tx) => {
        const coupons = await tx.coupon.findMany({
          where: cursor
            ? {
                OR: [
                  { createdAt: { lt: new Date(cursor.createdAt) } },
                  { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
                ],
              }
            : {},
          select: couponSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
        });
        const items = coupons.slice(0, limit).map(toCouponDto);
        const last = items.at(-1);
        return {
          items,
          nextCursor:
            coupons.length > limit && last
              ? encodeCouponCursor({ createdAt: last.createdAt, id: last.id })
              : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async increaseCapacity(
    actorUserId: string,
    couponId: string,
    maxUses: number,
  ): Promise<CouponDto> {
    return this.prisma.$transaction(async (tx) => {
      // Share the coupon lock with activation and payment claims; never read a stale limit.
      await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "id" = ${couponId}::uuid FOR UPDATE`;
      const before = await tx.coupon.findUnique({ where: { id: couponId }, select: couponSelect });
      if (!before) {
        throw new NotFoundException('Coupon not found');
      }
      if (!before.active) {
        throw new ConflictException({ code: 'COUPON_INACTIVE', message: 'Coupon is inactive' });
      }
      if (before.expiresAt.getTime() <= Date.now()) {
        throw new ConflictException({ code: 'COUPON_EXPIRED', message: 'Coupon has expired' });
      }
      if (maxUses < before.maxUses) {
        throw new ConflictException({
          code: 'COUPON_CAPACITY_DECREASE_NOT_ALLOWED',
          message: 'Coupon capacity cannot be decreased. Refresh the current limit.',
        });
      }
      // A desired total makes response-loss retries safe without applying an increment twice.
      if (maxUses === before.maxUses) {
        return toCouponDto(before);
      }
      const coupon = await tx.coupon.update({
        where: { id: couponId },
        data: { maxUses },
        select: couponSelect,
      });
      const auditId = randomUUID();
      await tx.auditLog.create({
        data: {
          id: auditId,
          actorUserId,
          action: 'coupon.capacity_increase',
          entityType: 'Coupon',
          entityId: couponId,
          beforeData: { maxUses: before.maxUses },
          afterData: { maxUses },
          operationKey: `coupon.capacity_increase:${auditId}`,
        },
        select: { id: true },
      });
      if (coupon.expiresAt.getTime() <= Date.now()) {
        throw new ConflictException({ code: 'COUPON_EXPIRED', message: 'Coupon has expired' });
      }
      return toCouponDto(coupon);
    });
  }
}
