import { Controller, Get } from '@nestjs/common';

import { CatalogsService } from '@/catalogs/catalogs.service';
import {
  CatalogsControllerDoc,
  GetGradeLevelsDoc,
  GetSubjectsDoc,
} from '@/catalogs/catalogs.swagger';

@CatalogsControllerDoc()
@Controller('catalogs')
export class CatalogsController {
  constructor(private readonly catalogs: CatalogsService) {}

  @Get('subjects')
  @GetSubjectsDoc()
  getSubjects() {
    return this.catalogs.getSubjects();
  }

  @Get('grade-levels')
  @GetGradeLevelsDoc()
  getGradeLevels() {
    return this.catalogs.getGradeLevels();
  }
}
