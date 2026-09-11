import { Controller, Get } from '@nestjs/common';

import { GradeLevelCatalogResponseDto, SubjectCatalogResponseDto } from '@/tutors/tutors.dto';
import { TutorsService } from '@/tutors/tutors.service';
import {
  CatalogControllerDoc,
  GetGradeLevelCatalogDoc,
  GetSubjectCatalogDoc,
} from '@/tutors/tutors.swagger';

@CatalogControllerDoc()
@Controller()
export class CatalogController {
  constructor(private readonly tutors: TutorsService) {}

  @Get('subjects')
  @GetSubjectCatalogDoc()
  getSubjects(): Promise<SubjectCatalogResponseDto> {
    return this.tutors.getActiveSubjects();
  }

  @Get('grade-levels')
  @GetGradeLevelCatalogDoc()
  getGradeLevels(): Promise<GradeLevelCatalogResponseDto> {
    return this.tutors.getActiveGradeLevels();
  }
}
