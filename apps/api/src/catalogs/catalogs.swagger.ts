import { applyDecorators } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { GradeLevelCatalogResponseDto, SubjectCatalogResponseDto } from '@/catalogs/catalogs.dto';

export function CatalogsControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('catalogs'));
}

export function GetSubjectsDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'List active teaching subjects' }),
    ApiOkResponse({ type: SubjectCatalogResponseDto }),
  );
}

export function GetGradeLevelsDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'List active grade levels in display order' }),
    ApiOkResponse({ type: GradeLevelCatalogResponseDto }),
  );
}
