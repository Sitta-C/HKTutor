import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JWT_BEARER_AUTH } from '@modules/auth/auth.swagger';

export class AvatarDto {
  @ApiProperty({ description: 'Transient signed download URL; do not persist', format: 'uri' })
  url!: string;

  @ApiProperty({ format: 'date-time', description: 'URL expiry, at most 300 seconds after issue' })
  expiresAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AvatarReadResponseDto {
  @ApiProperty({ type: AvatarDto, nullable: true })
  avatar!: AvatarDto | null;
}

export class AvatarMutationResponseDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  avatarUpdatedAt!: string | null;
}

export function AvatarsControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('avatars'), ApiBearerAuth(JWT_BEARER_AUTH));
}

function AvatarErrors(): MethodDecorator {
  return applyDecorators(
    ApiBadRequestResponse({ description: 'Invalid input or current privacy consent missing' }),
    ApiUnauthorizedResponse({ description: 'An active verified JWT session is required' }),
    ApiForbiddenResponse({ description: 'Only the owning active student or tutor may access' }),
    ApiNotFoundResponse({ description: 'Account not found' }),
    ApiServiceUnavailableResponse({
      description: 'Storage temporarily unavailable or bucket public',
    }),
  );
}

export function GetMyAvatarDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Get a short-lived URL for the current user avatar' }),
    ApiOkResponse({ type: AvatarReadResponseDto }),
    AvatarErrors(),
  );
}

export function UploadAvatarDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Replace the current student or tutor avatar',
      description:
        'One JPEG, PNG, or static WebP, at most 2 MiB and 16 megapixels. Re-encoded as WebP, ' +
        'centered within 512×512, metadata stripped. Optional during onboarding. No text fields.',
    }),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['file'],
        additionalProperties: false,
        properties: { file: { type: 'string', format: 'binary' } },
      },
    }),
    ApiCreatedResponse({ type: AvatarMutationResponseDto }),
    ApiPayloadTooLargeResponse({ description: 'File exceeds 2 MiB' }),
    ApiTooManyRequestsResponse({ description: 'At most 10 upload attempts per minute per IP' }),
    AvatarErrors(),
  );
}

export function DeleteAvatarDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Remove the current avatar; repeated deletion succeeds' }),
    ApiOkResponse({ type: AvatarMutationResponseDto }),
    AvatarErrors(),
  );
}

export function GetPublicTutorAvatarDoc(): MethodDecorator {
  return applyDecorators(
    ApiTags('avatars'),
    ApiOperation({ summary: 'Get an avatar URL for a publicly visible verified tutor' }),
    ApiOkResponse({ type: AvatarReadResponseDto }),
    ApiBadRequestResponse({ description: 'Invalid tutor UUID' }),
    ApiNotFoundResponse({ description: 'Tutor missing or excluded by public visibility rules' }),
    ApiServiceUnavailableResponse({
      description: 'Storage temporarily unavailable or bucket public',
    }),
  );
}
