import { ApiProperty } from '@nestjs/swagger';

import { Role } from '@/generated/prisma/client';

/**
 * DTO ของ response ที่ส่งกลับหลังผ่าน JwtAuthGuard และ RolesGuard แล้ว
 *
 * @ApiProperty ทำให้ Swagger ทราบชนิด คำอธิบาย และตัวอย่างของแต่ละ field
 * แต่ไม่ได้ทำ runtime validation เพราะ class นี้เป็น response DTO ไม่ใช่ request DTO
 */
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

/**
 * DTO ของตัวอย่าง endpoint ที่ตรวจทั้ง role และ ownership ของ private listing
 */
export class OwnedListingExampleResponseDto {
  @ApiProperty({
    description: 'Confirmation that authentication, role, and ownership checks succeeded',
    example: 'Private listing access accepted',
  })
  message!: string;

  @ApiProperty({
    description: 'Private teaching listing that passed the ownership check',
    example: '10000000-0000-4000-8000-000000000001',
    format: 'uuid',
  })
  listingId!: string;

  @ApiProperty({
    description: 'Authenticated user requesting the private listing',
    example: '20000000-0000-4000-8000-000000000001',
    format: 'uuid',
  })
  requesterId!: string;

  @ApiProperty({
    description: 'Current role checked before the ownership query',
    enum: Role,
    example: Role.TUTOR,
  })
  role!: Role;
}
