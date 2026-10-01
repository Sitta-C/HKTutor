import { Controller, Get, HttpCode, HttpStatus, Param, Query } from '@nestjs/common';

import { UuidParamPipe } from '@/common/pipes/uuid-param.pipe';
import { TutorAvailabilityService } from '@/tutors/tutor-availability.service';
import { TutorDirectoryService } from '@/tutors/tutor-directory.service';
import {
  AvailabilityPublicResponseDto,
  AvailabilityQueryDto,
  PublicTutorDetailResponseDto,
  TutorSearchQueryDto,
  TutorSearchResultDto,
} from '@/tutors/tutors.dto';
import {
  GetPublicTutorDoc,
  GetTutorAvailabilityDoc,
  SearchPublicTutorsDoc,
  TutorsPublicControllerDoc,
} from '@/tutors/tutors.swagger';

@TutorsPublicControllerDoc()
@Controller('tutors')
export class TutorsPublicController {
  constructor(
    private readonly directory: TutorDirectoryService,
    private readonly availability: TutorAvailabilityService,
  ) {}

  @Get()
  @SearchPublicTutorsDoc()
  search(@Query() query: TutorSearchQueryDto): Promise<TutorSearchResultDto[]> {
    return this.directory.searchPublicTutors(query);
  }

  @Get(':tutorId')
  @GetPublicTutorDoc()
  getPublicTutor(
    @Param('tutorId', UuidParamPipe) tutorId: string,
  ): Promise<PublicTutorDetailResponseDto> {
    return this.directory.getPublicTutor(tutorId);
  }

  @Get(':tutorId/availability')
  @HttpCode(HttpStatus.OK)
  @GetTutorAvailabilityDoc()
  getAvailabilityPublic(
    @Param('tutorId', UuidParamPipe) tutorId: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<AvailabilityPublicResponseDto[]> {
    return this.availability.getAvailabilityPublic(tutorId, query);
  }
}
