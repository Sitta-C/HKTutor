import { Controller, Get, Put, UseGuards, Res, HttpStatus, HttpCode, Body, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '@/auth/auth.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorator';
import { TutorProfileResponseDto, TutorProfileUpdateQueryDto } from '@/tutors/tutors.dto';
import { TutorsService } from '@/tutors/tutors.service';
import { GetUser } from '@/user/get-user.decorator';

@ApiTags('tutors')
@Controller('api/tutors')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TUTOR')
export class TutorsController {
  constructor(private readonly tutorsService: TutorsService) {}

  @Get('me/profile')
  @HttpCode(HttpStatus.OK)
  async getProfile(@GetUser('userId') userId: string, @Res({ passthrough: true }) res: Response): Promise<TutorProfileResponseDto> {
    if(!userId) {
      throw new BadRequestException(`userId missing`)
    }
    return this.tutorsService.getProfile(userId);
  }

  @Put('me/profile')
  @HttpCode(HttpStatus.OK)
  async putProfile(@GetUser('userId') userId: string, @Body() updateTutorProfileDto: TutorProfileUpdateQueryDto) {
    if(!userId) {
      throw new BadRequestException(`userId missing`)
    }
    return this.tutorsService.putProfile(userId, updateTutorProfileDto);
  }
}
