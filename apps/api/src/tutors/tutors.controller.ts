import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '@/auth/auth.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorator';
import { TutorProfileResponseDto } from '@/tutors/tutors.dto';
import { TutorsService } from '@/tutors/tutors.service';
import { GetUser } from '@/user/get-user.decorator';

@ApiTags('tutors')
@Controller('api/tutors')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TutorsController {
  constructor(private readonly tutorsService: TutorsService) {}

  @Get('me/profile')
  @Roles('TUTOR')
  async getProfile(@GetUser('userId') userId: string): Promise<TutorProfileResponseDto> {
    return this.tutorsService.getProfile(userId);
  }
}
