import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JWT_BEARER_AUTH } from '@modules/auth/auth.swagger';
import { TutorReportResponseDto } from '@modules/reports/reports.dto';

export function ReportsControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('Reports'));
}

export function GetMyTutorReportDoc(): MethodDecorator {
  return applyDecorators(
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiOperation({
      summary: 'Read all-time booking, completion-rate, and revenue report for the current tutor',
      description:
        'TUTOR only (verified email, active session, and current privacy consent). Aggregates all ' +
        'bookings owned by the authenticated tutor in one RepeatableRead snapshot, including ' +
        'historical bookings on archived or deleted listings. Revenue sums netAmount with Prisma ' +
        'Decimal strictly for PAID and COMPLETED bookings. Completion rate uses finalized = ' +
        'COMPLETED + CANCELED (excluding EXPIRED) and rounds HALF_UP to two decimals, or returns ' +
        'null when finalized is 0. Accepts no query parameters or request body.',
    }),
    ApiOkResponse({
      description: 'Consistent all-time tutor report snapshot (Cache-Control: no-store)',
      type: TutorReportResponseDto,
    }),
    ApiBadRequestResponse({
      description: 'Unexpected query parameters or non-empty request body',
      schema: {
        example: {
          statusCode: 400,
          error: 'Bad Request',
          message: ['property tutorId should not exist'],
          code: 'VALIDATION_FAILED',
        },
        type: 'object',
      },
    }),
    ApiUnauthorizedResponse({
      description: 'Missing, invalid, expired, or revoked access session',
      schema: {
        example: {
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid or expired authentication token',
          code: 'UNAUTHENTICATED',
        },
        type: 'object',
      },
    }),
    ApiForbiddenResponse({
      description: 'Caller is not a TUTOR or has missing/outdated privacy consent',
      schema: {
        example: {
          statusCode: 403,
          error: 'Forbidden',
          message: 'You do not have permission to access this resource',
          code: 'FORBIDDEN',
        },
        type: 'object',
      },
    }),
  );
}
