import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { configureApplication } from '@/app.setup';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { JWT_BEARER_AUTH } from '@/auth/auth.swagger';
import { ResourceOwnershipGuard } from '@/auth/ownership.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { TutorsController } from '@/tutors/tutors.controller';
import { TutorsService } from '@/tutors/tutors.service';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject, OperationObject, ReferenceObject } from '@nestjs/swagger';

describe('tutor listing Swagger contract', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [TutorsController],
      providers: [{ provide: TutorsService, useValue: {} }],
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
    await app.close();
  });

  it('uses the global API prefix once and documents the listing query', () => {
    const get = operation('get', '/api/v1/tutors/me/listings');

    expect(document.paths).not.toHaveProperty('/api/v1/api/tutors/me/listings');
    expect(get.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    expect(get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: 'query',
          name: 'publicationStatus',
          required: false,
        }),
      ]),
    );
    for (const status of ['200', '400', '401', '403']) {
      expect(get.responses).toHaveProperty(status);
    }
  });

  it('documents create input and the complete created listing response', () => {
    const post = operation('post', '/api/v1/tutors/me/listings');
    const requestSchema = post.requestBody as {
      content: { 'application/json': { schema: ReferenceObject } };
    };
    const responseSchema = post.responses['201'] as {
      content: { 'application/json': { schema: ReferenceObject } };
    };

    expect(requestSchema.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ListingPostRequestDto',
    );
    expect(responseSchema.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ListingResponseDto',
    );
  });

  it.each([
    ['patch', '/api/v1/tutors/me/listings/{listingId}'],
    ['post', '/api/v1/tutors/me/listings/{listingId}/publish'],
  ])('documents %s %s with owner-safe not-found behavior', (method, path) => {
    const endpoint = operation(method, path);

    expect(endpoint.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: 'path',
          name: 'listingId',
          schema: expect.objectContaining({ format: 'uuid' }) as object,
        }),
      ]),
    );
    expect(endpoint.responses).toHaveProperty('404');
  });

  function operation(method: string, path: string): OperationObject {
    const item = document.paths[path];
    const found = item?.[method as keyof typeof item] as OperationObject | undefined;
    if (!found) throw new Error(`Missing Swagger operation ${method.toUpperCase()} ${path}`);
    return found;
  }
});
