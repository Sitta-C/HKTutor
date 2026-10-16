import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { configureApplication } from '@app/app.setup';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JWT_BEARER_AUTH } from '@modules/auth/auth.swagger';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import {
  BookingRescheduleRequestsController,
  RescheduleRequestsController,
} from '@modules/reschedule-requests/reschedule-requests.controller';
import { RescheduleRequestsService } from '@modules/reschedule-requests/reschedule-requests.service';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject, OperationObject, ReferenceObject } from '@nestjs/swagger';

describe('RescheduleRequests Swagger contract', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [BookingRescheduleRequestsController, RescheduleRequestsController],
      providers: [
        { provide: RescheduleRequestsService, useValue: {} },
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ResourceOwnershipGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addBearerAuth({ scheme: 'bearer', type: 'http' }, JWT_BEARER_AUTH)
        .build(),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  function operation(method: string, path: string): OperationObject {
    const item = document.paths[path];
    const found = item?.[method as keyof typeof item] as OperationObject | undefined;
    if (!found) throw new Error(`Missing Swagger operation ${method.toUpperCase()} ${path}`);
    return found;
  }

  it('documents POST /api/v1/bookings/:bookingId/reschedule-requests', () => {
    const post = operation('post', '/api/v1/bookings/{bookingId}/reschedule-requests');
    const requestSchema = post.requestBody as {
      content: { 'application/json': { schema: ReferenceObject } };
    };

    expect(requestSchema.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/CreateRescheduleRequestDto',
    );
    expect(post.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    for (const status of ['201', '400', '401', '403', '404', '409']) {
      expect(post.responses).toHaveProperty(status);
    }
  });

  it('documents GET /api/v1/bookings/:bookingId/reschedule-requests/current', () => {
    const get = operation('get', '/api/v1/bookings/{bookingId}/reschedule-requests/current');

    expect(get.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    for (const status of ['200', '400', '401', '403', '404']) {
      expect(get.responses).toHaveProperty(status);
    }
  });

  it('documents POST /api/v1/reschedule-requests/:requestId/approve', () => {
    const post = operation('post', '/api/v1/reschedule-requests/{requestId}/approve');

    expect(post.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    for (const status of ['200', '400', '401', '403', '404', '409']) {
      expect(post.responses).toHaveProperty(status);
    }
  });

  it('documents POST /api/v1/reschedule-requests/:requestId/reject', () => {
    const post = operation('post', '/api/v1/reschedule-requests/{requestId}/reject');
    const requestSchema = post.requestBody as
      { content: { 'application/json': { schema: ReferenceObject } } } | undefined;

    expect(requestSchema?.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/RejectRescheduleRequestDto',
    );
    expect(post.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    for (const status of ['200', '400', '401', '403', '404', '409']) {
      expect(post.responses).toHaveProperty(status);
    }
  });

  it('documents POST /api/v1/reschedule-requests/:requestId/withdraw', () => {
    const post = operation('post', '/api/v1/reschedule-requests/{requestId}/withdraw');

    expect(post.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    for (const status of ['200', '400', '401', '403', '404', '409']) {
      expect(post.responses).toHaveProperty(status);
    }
  });
});
