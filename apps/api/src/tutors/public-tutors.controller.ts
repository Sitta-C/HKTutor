import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';

import {
  PublicTutorDetailResponseDto,
  TutorSearchQueryDto,
  TutorSearchResultDto,
} from '@/tutors/tutors.dto';
import { TutorsService } from '@/tutors/tutors.service';
import {
  PublicTutorsControllerDoc,
  GetPublicTutorDoc,
  SearchPublicTutorsDoc,
} from '@/tutors/tutors.swagger';

@PublicTutorsControllerDoc()
@Controller('tutors')
export class PublicTutorsController {
  constructor(private readonly tutors: TutorsService) {}

  @Get()
  @SearchPublicTutorsDoc()
  search(@Query() query: TutorSearchQueryDto): Promise<TutorSearchResultDto[]> {
    return this.tutors.searchPublicTutors(query);
  }

  @Get(':tutorId')
  @GetPublicTutorDoc()
  getPublicTutor(
    @Param('tutorId', ParseUUIDPipe) tutorId: string,
  ): Promise<PublicTutorDetailResponseDto> {
    return this.tutors.getPublicTutor(tutorId);
  }
}
