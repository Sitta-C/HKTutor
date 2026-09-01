import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  getSchemaPath,
} from '@nestjs/swagger';

import { TutorResponseDto } from '@/tutors/tutors.dto';

export function GetTutorsDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(TutorResponseDto),
    ApiOperation({ summary: 'Search public tutors' }),
    ApiQuery({
      example: 'Mathematics',
      name: 'subject',
      required: false,
      type: String,
    }),
    ApiQuery({
      example: 500,
      minimum: 0,
      name: 'maxPrice',
      required: false,
      type: Number,
    }),
    ApiOkResponse({
      description: 'Published tutors matching every supplied filter',
      schema: {
        example: [
          {
            displayName: 'Anan',
            grade: 'Grade 10',
            id: 'listing-1',
            pricePerHour: 500,
            rating: 4.8,
            subject: 'Mathematics',
          },
        ],
        items: { $ref: getSchemaPath(TutorResponseDto) },
        type: 'array',
      },
    }),
    ApiBadRequestResponse({
      description: 'A query parameter failed validation',
      schema: {
        example: {
          error: 'Bad Request',
          message: ['maxPrice must not be less than 0'],
          statusCode: 400,
        },
        type: 'object',
      },
    }),
  );
}
