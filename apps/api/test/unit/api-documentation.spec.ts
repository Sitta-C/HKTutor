import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { configureApplication } from '@app/app.setup';
import { JWT_BEARER_AUTH } from '@modules/auth/auth.swagger';

import type { INestApplication, Type } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Test-only values: AppModule validates configuration but nothing here connects anywhere. */
const DOCUMENTATION_ENV: Record<string, string> = {
  DATABASE_URL: 'postgresql://docs:docs@127.0.0.1:1/hktutor_docs_test',
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: 'documentation-contract-access-secret-0001',
  JWT_REFRESH_SECRET: 'documentation-contract-refresh-secret-001',
  RESEND_API_KEY: 're_documentation_test_only',
  EMAIL_FROM: 'HKTutor <no-reply@hktutor.test>',
  SUPABASE_URL: 'https://storage.example.test',
  SUPABASE_SECRET_KEY: 'sb_secret_documentation_test_only',
  SUPABASE_AVATAR_BUCKET: 'documentation-avatars',
  SUPABASE_DOCUMENT_BUCKET: 'documentation-documents',
};

/**
 * S2-T39: every route the application actually mounts must carry a complete Swagger contract.
 * The document is generated from the real AppModule, so a new controller or endpoint is covered
 * automatically and cannot ship undocumented.
 */
describe('API documentation contract (S2-T39)', () => {
  const previousEnv = { ...process.env };
  let app: INestApplication;
  let operations: { key: string; operation: Operation }[];

  beforeAll(async () => {
    Object.assign(process.env, DOCUMENTATION_ENV);
    // ConfigModule reads the environment when AppModule is first evaluated, so load it only now.
    const { AppModule } = jest.requireActual<{ AppModule: Type<unknown> }>('@app/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    operations = Object.entries(document.paths).flatMap(([path, item]) =>
      HTTP_METHODS.flatMap((method) => {
        const operation = item[method];
        return operation ? [{ key: `${method.toUpperCase()} ${path}`, operation }] : [];
      }),
    );
  });

  afterAll(async () => {
    await app.close();
    process.env = previousEnv;
  });

  function violations(check: (operation: Operation) => string | null): string[] {
    return operations.flatMap(({ key, operation }) => {
      const problem = check(operation);
      return problem ? [`${key}: ${problem}`] : [];
    });
  }

  function hasJwt(operation: Operation): boolean {
    return (operation.security ?? []).some((requirement) => JWT_BEARER_AUTH in requirement);
  }

  function responds(operation: Operation, status: string): boolean {
    return status in operation.responses;
  }

  it('documents every mounted route', () => {
    expect(operations.length).toBeGreaterThanOrEqual(66);
  });

  it('gives every operation a summary, a description, a tag and a success response', () => {
    expect(
      violations((operation) => {
        if (!operation.summary?.trim()) {
          return 'missing summary';
        }
        if (!operation.description?.trim()) {
          return 'missing description';
        }
        if (!operation.tags?.length) {
          return 'missing tag';
        }
        return Object.keys(operation.responses).some((status) => status.startsWith('2'))
          ? null
          : 'missing 2xx response';
      }),
    ).toEqual([]);
  });

  it('documents 401 for every JWT-protected operation', () => {
    expect(
      violations((operation) =>
        hasJwt(operation) && !responds(operation, '401') ? 'JWT route without 401' : null,
      ),
    ).toEqual([]);
  });

  it('documents 400 and 404 for every operation with a path parameter', () => {
    expect(
      violations((operation) => {
        const hasPathParameter = (operation.parameters ?? []).some(
          (parameter) => 'in' in parameter && parameter.in === 'path',
        );
        if (!hasPathParameter) {
          return null;
        }
        const missing = ['400', '404'].filter((status) => !responds(operation, status));
        return missing.length ? `path parameter without ${missing.join(', ')}` : null;
      }),
    ).toEqual([]);
  });

  it('documents 400 for every operation that accepts a request body', () => {
    expect(
      violations((operation) =>
        operation.requestBody && !responds(operation, '400') ? 'body without 400' : null,
      ),
    ).toEqual([]);
  });

  it('describes every error response', () => {
    expect(
      violations((operation) => {
        const undescribed = Object.entries(operation.responses)
          .filter(([status]) => /^[45]/.test(status))
          .filter(
            ([, response]) =>
              !response || !('description' in response) || !response.description.trim(),
          )
          .map(([status]) => status);
        return undescribed.length ? `undescribed ${undescribed.join(', ')}` : null;
      }),
    ).toEqual([]);
  });

  /** The acceptance-criteria resolutions recorded in tests/s2-t39-qa.md, as the client sees them. */
  describe('Sprint 2 acceptance-criteria resolutions', () => {
    function operation(key: string): Operation {
      const found = operations.find((candidate) => candidate.key === key);
      if (!found) {
        throw new Error(`${key} is not documented`);
      }
      return found.operation;
    }

    it('R1: chat history answers an unauthenticated caller with 401, an outsider with 403', () => {
      const history = operation('GET /api/v1/conversations/{conversationId}/messages');
      expect(Object.keys(history.responses)).toEqual(expect.arrayContaining(['401', '403']));
    });

    it('R2: reschedule targets distinguish invalid (400), missing (404) and reserved (409)', () => {
      const create = operation('POST /api/v1/bookings/{bookingId}/reschedule-requests');
      expect(Object.keys(create.responses)).toEqual(
        expect.arrayContaining(['400', '403', '404', '409']),
      );
      const reject = operation('POST /api/v1/reschedule-requests/{requestId}/reject');
      expect(reject.description).toMatch(/never holds/);
    });

    it('R3: confirmation is documented as non-terminal', () => {
      const confirm = operation('POST /api/v1/bookings/tutor/{bookingId}/confirm');
      expect(confirm.description).toMatch(/CONFIRMED is not terminal/);
    });

    it('R4: attendance documents pending as 400 and completion for either value', () => {
      const attendance = operation('PUT /api/v1/bookings/tutor/{bookingId}/attendance');
      expect(attendance.description).toMatch(/whichever value is recorded/);
      expect(attendance.description).toMatch(/still-pending booking returns 400/);
      const badRequest = attendance.responses['400'];
      expect(badRequest && 'description' in badRequest ? badRequest.description : '').toMatch(
        /PENDING/,
      );
    });
  });
});
