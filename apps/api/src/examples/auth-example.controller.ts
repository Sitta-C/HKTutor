import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { CurrentUser } from '@/auth/auth.decorator';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { RequireOwnership } from '@/auth/ownership.decorator';
import { ResourceOwnershipGuard } from '@/auth/ownership.guard';
import { Roles } from '@/auth/roles.decorator';
import { RolesGuard } from '@/auth/roles.guard';
import {
  AuthExampleResponseDto,
  OwnedListingExampleResponseDto,
} from '@/examples/auth-example.dto';
import {
  AuthExampleControllerDoc,
  GetOwnedListingExampleDoc,
  GetProtectedAuthExampleDoc,
} from '@/examples/auth-example.swagger';
import { Role } from '@/generated/prisma/client';

import type { AuthenticatedUser } from '@/auth/auth.guard';

/**
 * ตัวอย่าง endpoint ที่ใช้ authentication และ role-based authorization ครบทั้ง flow
 *
 * ลำดับการทำงานของ request:
 * 1. JwtAuthGuard ตรวจ Bearer access token และตรวจ session/user ในฐานข้อมูล
 * 2. JwtAuthGuard แนบข้อมูลผู้ใช้ที่เชื่อถือได้ไว้ใน request.auth
 * 3. RolesGuard อ่าน role ที่ @Roles กำหนด แล้วเปรียบเทียบกับ request.auth.role
 * 4. ResourceOwnershipGuard ตรวจ resource ID พร้อม owner scope เมื่อ endpoint กำหนด metadata
 * 5. @CurrentUser ดึง request.auth มาให้ controller ใช้งาน
 *
 * Swagger decorators มีหน้าที่สร้างเอกสาร API เท่านั้น ไม่ได้ป้องกัน endpoint จริง
 * การป้องกันจริงเกิดจาก @UseGuards, @Roles และ @RequireOwnership
 */
@AuthExampleControllerDoc()
@Controller('examples')
// Guard ทำงานจากซ้ายไปขวา: authenticate ก่อนตรวจ role แล้วจึงตรวจ ownership
@UseGuards(JwtAuthGuard, RolesGuard, ResourceOwnershipGuard)
export class AuthExampleController {
  @Get('protected')
  // รวม Swagger decorators ของ endpoint ไว้ในไฟล์ .swagger แยกจาก business logic
  @GetProtectedAuthExampleDoc()
  // เป็นเพียง metadata ให้ RolesGuard อ่าน จึงวางก่อนหรือหลัง @UseGuards ใน source ได้
  @Roles(Role.TUTOR, Role.ADMIN)
  // JwtAuthGuard รับประกันว่า request.auth มีค่าแล้วก่อน controller ถูกเรียก
  getProtectedExample(@CurrentUser() user: AuthenticatedUser): AuthExampleResponseDto {
    return {
      email: user.email,
      message: 'Authenticated tutor/admin request accepted',
      role: user.role,
      userId: user.id,
    };
  }

  @Get('private-listings/:listingId')
  @GetOwnedListingExampleDoc()
  @Roles(Role.TUTOR, Role.ADMIN)
  @RequireOwnership({
    resource: 'teachingListing',
    idParam: 'listingId',
    allowAdmin: true,
  })
  getOwnedListingExample(
    @Param('listingId') listingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): OwnedListingExampleResponseDto {
    return {
      listingId,
      message: 'Private listing access accepted',
      requesterId: user.id,
      role: user.role,
    };
  }
}
