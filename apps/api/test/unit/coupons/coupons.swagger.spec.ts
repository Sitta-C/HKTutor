import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import { CouponsController } from '@modules/coupons/coupons.controller';
import { COUPON_CODE_PATTERN, MAX_COUPON_USES } from '@modules/coupons/coupons.dto';
import { CouponsService } from '@modules/coupons/coupons.service';
import { COUPON_CODE_EXISTS_EXAMPLE } from '@modules/coupons/coupons.swagger';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject, OperationObject, SchemaObject } from '@nestjs/swagger';
import type { App } from 'supertest/types';

const BASE = '/api/v1/admin/coupons';

/** S3-T23: the published coupon contract must match DTO validation and the response mapper. */
describe('admin coupon Swagger contract', () => {
  let app: INestApplication<App>;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CouponsController],
      providers: [{ provide: CouponsService, useValue: {} }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    const response = await request(app.getHttpServer()).get('/api/v1/docs-json').expect(200);
    document = response.body as OpenAPIObject;
  });

  afterAll(async () => {
    await app.close();
  });

  function schema(name: string): SchemaObject {
    const found = document.components?.schemas?.[name];
    if (!found || '$ref' in found) {
      throw new Error(`Missing schema ${name}`);
    }
    return found;
  }

  function property(schemaName: string, name: string): SchemaObject {
    const found = schema(schemaName).properties?.[name];
    if (!found || '$ref' in found) {
      throw new Error(`Missing ${schemaName}.${name}`);
    }
    return found;
  }

  function operation(method: 'get' | 'post' | 'patch', path: string): OperationObject {
    const found = document.paths[path]?.[method];
    if (!found) {
      throw new Error(`Missing ${method.toUpperCase()} ${path}`);
    }
    return found;
  }

  it('exposes explicit activation and capacity changes with no generic edit or delete', () => {
    const coupons = Object.entries(document.paths).filter(([path]) => path.startsWith(BASE));
    expect(
      coupons.flatMap(([path, item]) =>
        (['get', 'put', 'post', 'patch', 'delete'] as const)
          .filter((method) => item[method])
          .map((method) => `${method.toUpperCase()} ${path}`),
      ),
    ).toEqual([
      `GET ${BASE}`,
      `POST ${BASE}`,
      `PATCH ${BASE}/{couponId}/activation`,
      `PATCH ${BASE}/{couponId}/capacity`,
    ]);
  });

  it('documents the create body exactly as validation enforces it', () => {
    expect(schema('CreateCouponDto').required?.sort()).toEqual([
      'code',
      'expiresAt',
      'maxUses',
      'percent',
    ]);
    expect(Object.keys(schema('CreateCouponDto').properties ?? {}).sort()).toEqual([
      'active',
      'code',
      'expiresAt',
      'maxUses',
      'percent',
    ]);
    expect(property('CreateCouponDto', 'code')).toMatchObject({
      pattern: COUPON_CODE_PATTERN.source,
      minLength: 3,
      maxLength: 32,
    });
    expect(property('CreateCouponDto', 'percent')).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 100,
    });
    expect(property('CreateCouponDto', 'maxUses')).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: MAX_COUPON_USES,
    });
    expect(property('CreateCouponDto', 'active')).toMatchObject({ type: 'boolean', default: true });
    const expiresAt = property('CreateCouponDto', 'expiresAt');
    expect(expiresAt).toMatchObject({
      format: 'date-time',
      example: '2026-11-30T16:59:59.000Z',
    });
    expect(expiresAt.description).toContain('now < expiresAt');
    expect(expiresAt.description).toContain('Date-only');
  });

  it('documents a bounded desired total and active, unexpired, monotonic capacity contract', () => {
    expect(Object.keys(schema('IncreaseCouponCapacityDto').properties ?? {})).toEqual(['maxUses']);
    expect(schema('IncreaseCouponCapacityDto').required).toEqual(['maxUses']);
    expect(property('IncreaseCouponCapacityDto', 'maxUses')).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: MAX_COUPON_USES,
    });
    expect(operation('patch', `${BASE}/{couponId}/capacity`).responses).toMatchObject({
      '200': expect.anything() as unknown,
      '400': expect.anything() as unknown,
      '401': expect.anything() as unknown,
      '403': expect.anything() as unknown,
      '404': expect.anything() as unknown,
      '409': expect.anything() as unknown,
    });
  });

  it('documents a safe coupon response with capacity counts and no audit fields', () => {
    expect(Object.keys(schema('CouponDto').properties ?? {}).sort()).toEqual([
      'active',
      'availableUses',
      'code',
      'consumedUses',
      'createdAt',
      'expiresAt',
      'id',
      'maxUses',
      'percent',
      'reservedUses',
      'updatedAt',
    ]);
    expect(property('CouponDto', 'consumedUses').description).toContain('never refunded');
    expect(property('CouponDto', 'availableUses').description).toBe(
      'maxUses - consumedUses - reservedUses.',
    );
    expect(Object.keys(schema('CouponListDto').properties ?? {}).sort()).toEqual([
      'items',
      'nextCursor',
    ]);
  });

  it('documents the duplicate-code conflict body and US9-1 traceability', () => {
    const create = operation('post', BASE);
    expect(JSON.stringify(create.responses['409'])).toContain(
      JSON.stringify(COUPON_CODE_EXISTS_EXAMPLE),
    );
    expect(create.description).toContain('US9-1');
    expect(create.description).toContain('no edit or delete route');
    expect(operation('get', BASE).description).toContain('never refunded');
  });
});
