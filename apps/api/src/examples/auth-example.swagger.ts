import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JWT_BEARER_AUTH } from '@/auth/auth.swagger';
import {
  AuthExampleResponseDto,
  OwnedListingExampleResponseDto,
} from '@/examples/auth-example.dto';

export function AuthExampleControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('examples'));
}

/**
 * Schema กลางสำหรับ response ที่ request ไม่ผ่าน authentication/authorization
 *
 * นี่เป็นเพียงตัวอย่างในเอกสาร OpenAPI ไม่ใช่ตัวสร้าง error response จริง
 * error จริงถูก throw จาก JwtAuthGuard หรือ RolesGuard และถูก NestJS serialize
 */
const errorResponseSchema = {
  example: {
    error: 'Unauthorized',
    message: 'Invalid or expired authentication token',
    statusCode: 401,
  },
  properties: {
    code: { type: 'string' },
    error: { type: 'string' },
    message: { type: 'string' },
    statusCode: { type: 'number' },
  },
  type: 'object',
} as const;

/**
 * รวม Swagger decorators ของ GET /api/v1/examples/protected ไว้เป็น decorator เดียว
 * เพื่อไม่ให้ controller เต็มไปด้วยรายละเอียดของเอกสาร API
 *
 * - ApiOperation: ชื่อ/คำอธิบาย operation ใน Swagger UI
 * - ApiBearerAuth: แสดงว่า endpoint ต้องส่ง Authorization: Bearer <access-token>
 * - ApiOkResponse: รูปแบบ response เมื่อผ่าน guard ทั้งหมด
 * - ApiUnauthorizedResponse (401): ยังยืนยันตัวตนไม่ได้ เช่น token หมดอายุหรือ session ถูกเพิกถอน
 * - ApiForbiddenResponse (403): ยืนยันตัวตนแล้ว แต่ role ไม่ได้รับอนุญาต
 *
 * JWT_BEARER_AUTH ต้องมีชื่อเดียวกับ security scheme ที่ลงทะเบียนด้วย
 * DocumentBuilder.addBearerAuth(...) ในการตั้งค่า Swagger หลัก
 *
 * หมายเหตุ: decorator ชุดนี้สร้างเอกสารเท่านั้น ต้องใช้ JwtAuthGuard/RolesGuard
 * ที่ controller หรือ method ด้วย จึงจะมีการบังคับ security ตอน runtime
 */
export function GetProtectedAuthExampleDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Example of a JWT-protected endpoint restricted to tutors and admins',
    }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiOkResponse({
      description: 'The JWT, backing session, account state, and role are valid',
      type: AuthExampleResponseDto,
    }),
    ApiUnauthorizedResponse({
      description:
        'The access token or its backing session is missing, invalid, expired, or revoked',
      schema: errorResponseSchema,
    }),
    ApiForbiddenResponse({
      description: 'The authenticated user is not a tutor or admin',
      schema: {
        ...errorResponseSchema,
        example: {
          error: 'Forbidden',
          message: 'You do not have permission to access this resource',
          statusCode: 403,
        },
      },
    }),
  );
}

/**
 * Swagger contract ของ endpoint ตัวอย่างที่ใช้ authentication, role และ ownership guards
 */
export function GetOwnedListingExampleDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Example of owner-scoped access to a private teaching listing',
    }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiOkResponse({
      description: 'The authenticated tutor owns the listing, or admin access was allowed',
      type: OwnedListingExampleResponseDto,
    }),
    ApiBadRequestResponse({
      description: 'The listing ID is not a valid UUID',
      schema: {
        ...errorResponseSchema,
        example: {
          code: 'INVALID_UUID',
          error: 'Bad Request',
          message: 'listingId must be a valid UUID',
          statusCode: 400,
        },
      },
    }),
    ApiUnauthorizedResponse({
      description:
        'The access token or its backing session is missing, invalid, expired, or revoked',
      schema: errorResponseSchema,
    }),
    ApiForbiddenResponse({
      description: 'The authenticated user is not a tutor or admin',
      schema: {
        ...errorResponseSchema,
        example: {
          error: 'Forbidden',
          message: 'You do not have permission to access this resource',
          statusCode: 403,
        },
      },
    }),
    ApiNotFoundResponse({
      description: 'The private listing is missing or inaccessible to the authenticated user',
      schema: {
        ...errorResponseSchema,
        example: {
          error: 'Not Found',
          message: 'Resource not found',
          statusCode: 404,
        },
      },
    }),
  );
}
