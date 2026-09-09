import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorator';
import { SearchTutorsQueryDto, TutorResponseDto, TutorProfileResponseDto } from '@/tutors/tutors.dto';
import { TutorsService } from '@/tutors/tutors.service';
import { GetTutorsDoc } from '@/tutors/tutors.swagger';
import { GetUser } from '@/user/get-user.decorator';

@ApiTags('tutors')
@Controller('api/tutors')
export class TutorsController {
  constructor(private readonly tutorsService: TutorsService) {}

  @Get()
  @GetTutorsDoc()
  async search(@Query() query: SearchTutorsQueryDto): Promise<TutorResponseDto[]> {
    return this.tutorsService.search(query);
  }

  @Get('me/profile')
  @Roles('TUTOR')
  async getProfile(@GetUser('userId') userId: string): Promise<TutorProfileResponseDto> {
    return this.tutorsService.getProfile(userId);
  }
}
