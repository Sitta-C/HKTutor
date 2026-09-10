import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { configureApplication } from '@/app.setup';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { JWT_BEARER_AUTH } from '@/auth/auth.swagger';
import { RolesGuard } from '@/auth/roles.guard';
import { ProfilesController } from '@/profiles/profiles.controller';
import { ProfilesService } from '@/profiles/profiles.service';

import type { INestApplication } from '@nestjs/common';
import type {
  OpenAPIObject,
  OperationObject,
  ReferenceObject,
  SchemaObject,
} from '@nestjs/swagger';

describe('student profile Swagger contract', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [ProfilesController],
      providers: [{ provide: ProfilesService, useValue: {} }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
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

  it('documents the student upsert body, response, errors, and owner security', () => {
    const put = operation('put', '/api/v1/profiles/me/student');
    const requestSchema = put.requestBody as {
      content: { 'application/json': { schema: ReferenceObject } };
    };

    expect(requestSchema.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/SaveStudentProfileDto',
    );
    expect(put.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    for (const status of ['200', '400', '401', '403']) {
      expect(put.responses).toHaveProperty(status);
    }

    const schema = document.components?.schemas?.['SaveStudentProfileDto'] as SchemaObject;
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'firstName',
        'lastName',
        'nickname',
        'school',
        'gradeLevel',
        'phone',
      ]),
    );
    expect(schema.properties).toMatchObject({
      firstName: { maxLength: 100, minLength: 1, type: 'string' },
      nickname: { maxLength: 60, minLength: 1, type: 'string' },
      phone: { maxLength: 32, minLength: 8, pattern: '^[+0-9][0-9 ()-]{7,31}$' },
      school: { maxLength: 160, minLength: 1, type: 'string' },
    });
  });

  it('documents the private profile response and stale-consent error', () => {
    const get = operation('get', '/api/v1/profiles/me');

    for (const status of ['200', '400', '401']) {
      expect(get.responses).toHaveProperty(status);
    }
    expect(document.components?.schemas).toHaveProperty('MyProfileResponseDto');
    expect(document.components?.schemas).toHaveProperty('TutorProfileResponseDto');
  });

  function operation(method: string, path: string): OperationObject {
    const item = document.paths[path];
    const found = item?.[method as keyof typeof item] as OperationObject | undefined;
    if (!found) throw new Error(`Missing Swagger operation ${method.toUpperCase()} ${path}`);
    return found;
  }
});
