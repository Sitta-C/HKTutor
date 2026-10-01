import { Controller, Get } from '@nestjs/common';

import { TutorDirectoryService } from '@modules/tutors/tutor-directory.service';
import {
  GradeLevelCatalogResponseDto,
  SubjectCatalogResponseDto,
} from '@modules/tutors/tutors.dto';
import {
  CatalogControllerDoc,
  GetGradeLevelCatalogDoc,
  GetSubjectCatalogDoc,
} from '@modules/tutors/tutors.swagger';

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
