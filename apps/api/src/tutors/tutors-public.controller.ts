import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Query } from '@nestjs/common';

import { UuidParamPipe } from '@/common/pipes/uuid-param.pipe';
import {
  AvailabilityPublicResponseDto,
  AvailabilityQueryDto,
  PublicTutorDetailResponseDto,
  TutorSearchQueryDto,
  TutorSearchResultDto,
} from '@/tutors/tutors.dto';
import { TutorsService } from '@/tutors/tutors.service';
import {
  GetPublicTutorDoc,
  GetTutorAvailabilityDoc,
  SearchPublicTutorsDoc,
  TutorsPublicControllerDoc,
} from '@/tutors/tutors.swagger';

@TutorsPublicControllerDoc()
@Controller('tutors')
export class TutorsPublicController {
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

  @Get(':tutorId/availability')
  @HttpCode(HttpStatus.OK)
  @GetTutorAvailabilityDoc()
  getAvailabilityPublic(
    @Param('tutorId', UuidParamPipe) tutorId: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<AvailabilityPublicResponseDto[]> {
    return this.tutors.getAvailabilityPublic(tutorId, query);
  }
}
