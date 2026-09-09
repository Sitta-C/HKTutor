import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JWT_BEARER_AUTH } from '@/auth/auth.swagger';

export function ProfilesControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('profiles'), ApiBearerAuth(JWT_BEARER_AUTH));
}

export function GetMyProfileDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Get the current user profile and onboarding status' }),
    ApiOkResponse({ description: 'Role-specific private profile returned to its owner' }),
  );
}

export function SaveStudentProfileDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Create or update the current student profile' }),
    ApiOkResponse({ description: 'Student profile saved' }),
  );
}

export function SaveTutorProfileDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Create or update the current tutor profile' }),
    ApiOkResponse({ description: 'Tutor profile saved' }),
  );
}
