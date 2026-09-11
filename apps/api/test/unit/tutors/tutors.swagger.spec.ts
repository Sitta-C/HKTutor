import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { configureApplication } from '@/app.setup';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { JWT_BEARER_AUTH } from '@/auth/auth.swagger';
import { ResourceOwnershipGuard } from '@/auth/ownership.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { CatalogController } from '@/tutors/catalog.controller';
import { TutorsPrivateController } from '@/tutors/tutors-private.controller';
import { TutorsPublicController } from '@/tutors/tutors-public.controller';
import { TutorsService } from '@/tutors/tutors.service';

import type { INestApplication } from '@nestjs/common';
import type {
  OpenAPIObject,
  OperationObject,
  ReferenceObject,
  SchemaObject,
} from '@nestjs/swagger';

describe('tutor Swagger contract', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [CatalogController, TutorsPrivateController, TutorsPublicController],
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

    const listingSchema = document.components?.schemas?.['ListingResponseDto'] as SchemaObject;
    expect(listingSchema.required).toEqual(
      expect.arrayContaining([
        'id',
        'subject',
        'gradeLevel',
        'pricePerHour',
        'description',
        'publicationStatus',
        'publishedAt',
        'createdAt',
        'updatedAt',
      ]),
    );
    expect(listingSchema.properties).toMatchObject({
      createdAt: { format: 'date-time', type: 'string' },
      id: { format: 'uuid', type: 'string' },
      updatedAt: { format: 'date-time', type: 'string' },
    });

    const gradeLevelSchema = document.components?.schemas?.[
      'GradeLevelOptionResponseDto'
    ] as SchemaObject;
    expect(gradeLevelSchema.properties).toMatchObject({
      sortOrder: { minimum: 0, type: 'number' },
    });
  });

  it.each([
    ['get', '/api/v1/tutors/me/listings/{listingId}'],
    ['patch', '/api/v1/tutors/me/listings/{listingId}'],
    ['patch', '/api/v1/tutors/me/listings/{listingId}/status'],
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
    expect(endpoint.responses).toHaveProperty('400');
    expect(endpoint.responses).toHaveProperty('404');
  });

  it('documents that listing PATCH requires at least one property', () => {
    const patch = operation('patch', '/api/v1/tutors/me/listings/{listingId}');
    const requestSchema = patch.requestBody as {
      content: { 'application/json': { schema: SchemaObject } };
    };

    expect(requestSchema.content['application/json'].schema).toMatchObject({
      allOf: [{ $ref: '#/components/schemas/ListingPatchRequestDto' }],
      minProperties: 1,
    });
  });

  it('documents the listing status request enum', () => {
    const patch = operation('patch', '/api/v1/tutors/me/listings/{listingId}/status');
    const requestSchema = patch.requestBody as {
      content: { 'application/json': { schema: ReferenceObject } };
    };

    expect(requestSchema.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ListingStatusRequestDto',
    );
    const statusSchema = document.components?.schemas?.['ListingStatusRequestDto'] as SchemaObject;
    expect(statusSchema.required).toContain('publicationStatus');
  });

  it('uses one listing response schema for all listing endpoints', () => {
    const listResponse = operation('get', '/api/v1/tutors/me/listings').responses['200'] as {
      content: { 'application/json': { schema: SchemaObject } };
    };
    expect(listResponse.content['application/json'].schema).toMatchObject({
      items: { $ref: '#/components/schemas/ListingResponseDto' },
      type: 'array',
    });

    for (const [method, path, status] of [
      ['get', '/api/v1/tutors/me/listings/{listingId}', '200'],
      ['post', '/api/v1/tutors/me/listings', '201'],
      ['patch', '/api/v1/tutors/me/listings/{listingId}', '200'],
      ['patch', '/api/v1/tutors/me/listings/{listingId}/status', '200'],
      ['post', '/api/v1/tutors/me/listings/{listingId}/publish', '200'],
    ]) {
      const response = operation(method, path).responses[status] as {
        content: { 'application/json': { schema: ReferenceObject } };
      };
      expect(response.content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ListingResponseDto',
      );
    }
  });

  it('documents the public search contract without bearer security', () => {
    const search = operation('get', '/api/v1/tutors');

    expect(search.security).toBeUndefined();
    expect(search.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ in: 'query', name: 'subject', required: false }),
        expect.objectContaining({ in: 'query', name: 'grade', required: false }),
        expect.objectContaining({ in: 'query', name: 'maxPrice', required: false }),
        expect.objectContaining({ in: 'query', name: 'minimumRating', required: false }),
      ]),
    );
    expect(search.responses).toHaveProperty('200');
    expect(search.responses).toHaveProperty('400');

    const response = search.responses['200'] as {
      content: { 'application/json': { schema: SchemaObject } };
    };
    expect(response.content['application/json'].schema).toMatchObject({
      items: { $ref: '#/components/schemas/TutorSearchResultDto' },
      type: 'array',
    });

    const resultSchema = document.components?.schemas?.['TutorSearchResultDto'] as SchemaObject;
    expect(resultSchema.required).toEqual(
      expect.arrayContaining([
        'listingId',
        'tutorId',
        'displayName',
        'description',
        'experienceYears',
        'subject',
        'grade',
        'pricePerHour',
        'ratingAverage',
        'reviewCount',
        'nextAvailableAt',
      ]),
    );
    expect(resultSchema.properties).not.toHaveProperty('id');
    expect(resultSchema.properties?.['nextAvailableAt']).toMatchObject({
      format: 'date-time',
      nullable: true,
      type: 'string',
    });
  });

  it('documents private availability list, validation, state, and authentication', () => {
    const get = operation('get', '/api/v1/tutors/me/availability');

    expect(get.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    expect(get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ in: 'query', name: 'from', required: false }),
        expect.objectContaining({ in: 'query', name: 'to', required: false }),
      ]),
    );
    for (const status of ['200', '400', '401', '403']) {
      expect(get.responses).toHaveProperty(status);
    }

    const response = get.responses['200'] as {
      content: { 'application/json': { schema: SchemaObject } };
    };
    expect(response.content['application/json'].schema).toMatchObject({
      items: { $ref: '#/components/schemas/AvailabilityPrivateResponseDto' },
      type: 'array',
    });
    const schema = document.components?.schemas?.['AvailabilityPrivateResponseDto'] as SchemaObject;
    expect(schema.required).toEqual(
      expect.arrayContaining(['id', 'startAtUtc', 'endAtUtc', 'createdAt', 'state']),
    );
    expect(schema.properties?.['state']).toMatchObject({
      allOf: [{ $ref: '#/components/schemas/AvailabilityState' }],
    });
    expect(document.components?.schemas?.['AvailabilityState']).toMatchObject({
      enum: ['OPEN', 'RESERVED'],
      type: 'string',
    });
  });

  it('documents availability creation with contract input names and conflict response', () => {
    const post = operation('post', '/api/v1/tutors/me/availability');
    const request = post.requestBody as {
      content: { 'application/json': { schema: ReferenceObject } };
    };
    const response = post.responses['201'] as {
      content: { 'application/json': { schema: ReferenceObject } };
    };

    expect(request.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/AvailabilityPostRequestDto',
    );
    expect(response.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/AvailabilityPostResponseDto',
    );
    for (const status of ['201', '400', '401', '403', '409']) {
      expect(post.responses).toHaveProperty(status);
    }

    const requestSchema = document.components?.schemas?.[
      'AvailabilityPostRequestDto'
    ] as SchemaObject;
    expect(requestSchema.required).toEqual(['startAt', 'endAt']);
    expect(requestSchema.properties).toMatchObject({
      endAt: { format: 'date-time', type: 'string' },
      startAt: { format: 'date-time', type: 'string' },
    });
    expect(requestSchema.properties).not.toHaveProperty('startAtUtc');
    expect(requestSchema.properties).not.toHaveProperty('endAtUtc');
  });

  it('documents availability deletion and its reserved-slot response', () => {
    const remove = operation('delete', '/api/v1/tutors/me/availability/{slotId}');

    expect(remove.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: 'path',
          name: 'slotId',
          schema: expect.objectContaining({ format: 'uuid' }) as object,
        }),
      ]),
    );
    for (const status of ['204', '400', '401', '403', '404', '409']) {
      expect(remove.responses).toHaveProperty(status);
    }
  });

  it('documents public availability without bearer security', () => {
    const get = operation('get', '/api/v1/tutors/{tutorId}/availability');

    expect(get.security).toBeUndefined();
    expect(get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: 'path',
          name: 'tutorId',
          schema: expect.objectContaining({ format: 'uuid' }) as object,
        }),
        expect.objectContaining({ in: 'query', name: 'from', required: false }),
        expect.objectContaining({ in: 'query', name: 'to', required: false }),
      ]),
    );
    for (const status of ['200', '400', '404']) {
      expect(get.responses).toHaveProperty(status);
    }

    const response = get.responses['200'] as {
      content: { 'application/json': { schema: SchemaObject } };
    };
    expect(response.content['application/json'].schema).toMatchObject({
      items: { $ref: '#/components/schemas/AvailabilityPublicResponseDto' },
      type: 'array',
    });
  });

  it('documents public detail and both active catalogs', () => {
    const detail = operation('get', '/api/v1/tutors/{tutorId}');
    expect(detail.security).toBeUndefined();
    expect(detail.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: 'path',
          name: 'tutorId',
          schema: expect.objectContaining({ format: 'uuid' }) as object,
        }),
      ]),
    );
    expect(detail.responses).toHaveProperty('200');
    expect(detail.responses).toHaveProperty('400');
    expect(detail.responses).toHaveProperty('404');

    for (const path of ['/api/v1/subjects', '/api/v1/grade-levels']) {
      const catalog = operation('get', path);
      expect(catalog.security).toBeUndefined();
      expect(catalog.responses).toHaveProperty('200');
      expect(catalog.responses).toHaveProperty('503');
    }
  });

  function operation(method: string, path: string): OperationObject {
    const item = document.paths[path];
    const found = item?.[method as keyof typeof item] as OperationObject | undefined;
    if (!found) throw new Error(`Missing Swagger operation ${method.toUpperCase()} ${path}`);
    return found;
  }
});
