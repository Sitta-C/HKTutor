import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JWT_BEARER_AUTH } from '@/auth/auth.swagger';

export function TutorsControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('tutors'), ApiBearerAuth(JWT_BEARER_AUTH));
}

export function GetMyListingsDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Get all listings of current user where it is not deleted' }),
    ApiOkResponse({ description: 'Role-specific private listings returned to its owner' }),
  );
}

export function PostListingDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Post a listing of current user' }),
    ApiOkResponse({ description: 'TutorProfileId is returned to its owner' }),
  );
}

export function PatchListingDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Update a listing of current user where it is not deleted' }),
    ApiOkResponse({ description: 'Role-specific private listing returned to its owner' }),
  );
}

export function PublishListingDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Publish a listing of current user where it is not deleted' }),
    ApiOkResponse({ description: 'Role-specific private listing which is published and its published timestamp returned to its owner' }),
  );
}