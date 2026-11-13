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

const NO_BOOKINGS = { PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELED: 0, EXPIRED: 0 };

/**
 * S3-T12: each named example is the exact report for one S3-DB04 fixture tutor, so Swagger never
 * shows numbers the seeded demo data cannot reproduce. Unit tests recompute every example from the
 * fixture bookings through ReportsService.
 */
export const TUTOR_REPORT_EXAMPLES = {
  report905: {
    summary:
      'DB04 report905 tutor: paid completed net 405.00 (450.00 less 10% WELCOME10) + 500.00 = ' +
      '905.00 THB; 6 / (6 + 2) = 75%',
    value: {
      totalBookings: 12,
      statusCounts: { PENDING: 3, CONFIRMED: 1, COMPLETED: 6, CANCELED: 2, EXPIRED: 0 },
      revenue: { amount: '905.00', currency: 'THB' },
      completionRate: { completed: 6, finalized: 8, percent: 75 },
    },
  },
  reportExpired: {
    summary:
      'DB04 reportExpired tutor: one EXPIRED request, no finalized booking, so percent is null',
    value: {
      totalBookings: 1,
      statusCounts: { ...NO_BOOKINGS, EXPIRED: 1 },
      revenue: { amount: '0.00', currency: 'THB' },
      completionRate: { completed: 0, finalized: 0, percent: null },
    },
  },
  reportEmpty: {
    summary: 'DB04 reportEmpty tutor: no bookings yet',
    value: {
      totalBookings: 0,
      statusCounts: NO_BOOKINGS,
      revenue: { amount: '0.00', currency: 'THB' },
      completionRate: { completed: 0, finalized: 0, percent: null },
    },
  },
} as const satisfies Record<string, { summary: string; value: TutorReportResponseDto }>;

export function ReportsControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('reports'));
}

export function GetMyTutorReportDoc(): MethodDecorator {
  return applyDecorators(
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiOperation({
      summary: 'Read all-time booking, completion-rate, and revenue report for the current tutor',
      description:
        'TUTOR only (verified email, active session, and current privacy consent). Aggregates all ' +
        'bookings owned by the authenticated tutor in a single database snapshot query, including ' +
        'historical bookings on archived or deleted listings. Revenue sums netAmount with Prisma ' +
        'Decimal strictly for PAID and COMPLETED bookings; netAmount is the booking snapshot after ' +
        'any coupon discount, and a PAID booking can never be CANCELED, so canceled, unpaid, ' +
        'pending, confirmed and expired amounts are never revenue. Per S3-T09, completionRate.finalized ' +
        'equals COMPLETED + CANCELED — counting all CANCELED bookings (both tutor rejections of ' +
        'PENDING requests and student/tutor cancellations) while excluding EXPIRED, PENDING, and ' +
        'CONFIRMED — and percent rounds HALF_UP to two decimals (null when finalized is 0). ' +
        'Accepts no query parameters or request body.',
    }),
    ApiOkResponse({
      description: 'Consistent all-time tutor report snapshot (Cache-Control: no-store)',
      type: TutorReportResponseDto,
      examples: TUTOR_REPORT_EXAMPLES,
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
