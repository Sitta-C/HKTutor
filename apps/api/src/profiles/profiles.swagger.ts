import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiUnauthorizedResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';

import { JWT_BEARER_AUTH } from '@/auth/auth.swagger';
import { Role } from '@/generated/prisma/client';
import { SaveStudentProfileDto, SaveTutorProfileDto } from '@/profiles/profiles.dto';

class ApiErrorResponseDto {
  @ApiProperty({ example: 400, type: Number })
  statusCode!: number;

  @ApiProperty({
    oneOf: [
      { example: 'Accept the current privacy notice before viewing a profile', type: 'string' },
      { items: { type: 'string' }, type: 'array' },
    ],
  })
  message!: string | string[];

  @ApiProperty({ example: 'Bad Request' })
  error!: string;
}

class TutorProfileResponseDto {
  @ApiProperty({ example: 'Anan', nullable: true, type: String })
  firstName!: string | null;

  @ApiProperty({ example: 'Sukjai', nullable: true, type: String })
  lastName!: string | null;

  @ApiProperty({ example: 'Anan', nullable: true, type: String })
  nickname!: string | null;

  @ApiProperty({ example: 'Kru Anan' })
  displayName!: string;

  @ApiProperty({ example: 'Mathematics tutor' })
  bio!: string;

  @ApiProperty({ example: 5, minimum: 0, type: Number })
  experienceYears!: number;

  @ApiProperty({ enum: ['PENDING', 'VERIFIED', 'REJECTED'], example: 'PENDING' })
  verificationStatus!: 'PENDING' | 'VERIFIED' | 'REJECTED';

  @ApiProperty({ example: '4.50', nullable: true, type: String })
  ratingAverage!: string | null;

  @ApiProperty({ example: 12, minimum: 0, type: Number })
  reviewCount!: number;

  @ApiProperty({ example: '2026-09-10T01:00:00.000Z', format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-09-10T01:00:00.000Z', format: 'date-time' })
  updatedAt!: Date;
}

class MyProfileResponseDto {
  @ApiProperty({ enum: Role, enumName: 'Role', example: Role.STUDENT })
  role!: Role;

  @ApiProperty({ example: true })
  consentCurrent!: boolean;

  @ApiProperty({ example: '2026-09-09' })
  policyVersion!: string;

  @ApiProperty({ example: true })
  profileComplete!: boolean;

  @ApiProperty({
    nullable: true,
    oneOf: [
      { $ref: getSchemaPath(SaveStudentProfileDto) },
      { $ref: getSchemaPath(TutorProfileResponseDto) },
    ],
  })
  profile!: SaveStudentProfileDto | TutorProfileResponseDto | null;
}

const unauthorizedDescription = 'A valid access token and active verified session are required';
const consentDescription = 'The current privacy notice must be accepted';

export function ProfilesControllerDoc(): ClassDecorator {
  return applyDecorators(
    ApiTags('profiles'),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiExtraModels(
      ApiErrorResponseDto,
      MyProfileResponseDto,
      SaveStudentProfileDto,
      SaveTutorProfileDto,
      TutorProfileResponseDto,
    ),
  );
}

export function GetMyProfileDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Get the current user profile and onboarding status' }),
    ApiOkResponse({
      description: 'Role-specific private profile returned to its owner',
      type: MyProfileResponseDto,
    }),
    ApiBadRequestResponse({ description: consentDescription, type: ApiErrorResponseDto }),
    ApiUnauthorizedResponse({ description: unauthorizedDescription, type: ApiErrorResponseDto }),
  );
}

export function SaveStudentProfileDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Create or update the current student profile' }),
    ApiBody({ type: SaveStudentProfileDto }),
    ApiOkResponse({ description: 'Student profile saved', type: SaveStudentProfileDto }),
    ApiBadRequestResponse({
      description: 'The request is invalid or the current privacy notice has not been accepted',
      type: ApiErrorResponseDto,
    }),
    ApiUnauthorizedResponse({ description: unauthorizedDescription, type: ApiErrorResponseDto }),
    ApiForbiddenResponse({
      description: 'Only a student can save a student profile',
      type: ApiErrorResponseDto,
    }),
  );
}

export function SaveTutorProfileDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Create or update the current tutor profile' }),
    ApiBody({ type: SaveTutorProfileDto }),
    ApiOkResponse({ description: 'Tutor profile saved', type: TutorProfileResponseDto }),
    ApiBadRequestResponse({
      description: 'The request is invalid or the current privacy notice has not been accepted',
      type: ApiErrorResponseDto,
    }),
    ApiUnauthorizedResponse({ description: unauthorizedDescription, type: ApiErrorResponseDto }),
    ApiForbiddenResponse({
      description: 'Only a tutor can save a tutor profile',
      type: ApiErrorResponseDto,
    }),
  );
}
