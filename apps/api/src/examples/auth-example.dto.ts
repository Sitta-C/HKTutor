import { ApiProperty } from '@nestjs/swagger';

import { Role } from '@/generated/prisma/client';

export class AuthExampleResponseDto {
  @ApiProperty({
    description: 'Confirmation that both authentication and role authorization succeeded',
    example: 'Authenticated tutor/admin request accepted',
  })
  message!: string;

  @ApiProperty({
    description: 'Current user ID resolved from the JWT-backed database session',
    example: 'cm1234567890abcdef',
  })
  userId!: string;

  @ApiProperty({
    description: 'Current email loaded by JwtAuthGuard',
    example: 'tutor@example.com',
  })
  email!: string;

  @ApiProperty({
    description: 'Current role checked by RolesGuard',
    enum: Role,
    example: Role.TUTOR,
  })
  role!: Role;
}
