import { Controller, Get } from '@nestjs/common';

import { TutorDirectoryService } from '@/tutors/tutor-directory.service';
import { GradeLevelCatalogResponseDto, SubjectCatalogResponseDto } from '@/tutors/tutors.dto';
import {
  CatalogControllerDoc,
  GetGradeLevelCatalogDoc,
  GetSubjectCatalogDoc,
} from '@/tutors/tutors.swagger';

@CatalogControllerDoc()
@Controller()
export class CatalogController {
  constructor(private readonly directory: TutorDirectoryService) {}

  @Get('subjects')
  @GetSubjectCatalogDoc()
  getSubjects(): Promise<SubjectCatalogResponseDto> {
    return this.directory.getActiveSubjects();
  }

  @Get('grade-levels')
  @GetGradeLevelCatalogDoc()
  getGradeLevels(): Promise<GradeLevelCatalogResponseDto> {
    return this.directory.getActiveGradeLevels();
  }
}
