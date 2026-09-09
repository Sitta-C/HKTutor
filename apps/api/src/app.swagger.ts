import { applyDecorators } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

export function AppControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('authentication'));
}
