import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { SearchTutorsQueryDto, TutorResponseDto } from '@/tutors/tutors.dto';
import { TutorsService } from '@/tutors/tutors.service';
import { GetTutorsDoc } from '@/tutors/tutors.swagger';

@ApiTags('tutors')
@Controller('api/tutors')
export class TutorsController {
  constructor(private readonly tutorsService: TutorsService) {}

  @Get()
  @GetTutorsDoc()
  async search(@Query() query: SearchTutorsQueryDto): Promise<TutorResponseDto[]> {
    return this.tutorsService.search(query);
  }
}
