import { applyDecorators } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

export function HealthControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('health'));
}

export function GetHealthDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Check database connectivity' }),
    ApiOkResponse({
      description: 'The database connection is healthy',
      schema: {
        example: { database: 'connected' },
        properties: {
          database: { enum: ['connected'], example: 'connected', type: 'string' },
        },
        required: ['database'],
        type: 'object',
      },
    }),
    ApiServiceUnavailableResponse({
      description: 'The database connection is unavailable',
      schema: {
        example: { database: 'disconnected' },
        properties: {
          database: { enum: ['disconnected'], example: 'disconnected', type: 'string' },
        },
        required: ['database'],
        type: 'object',
      },
    }),
  );
}
