import { Body, Controller, Get, Header, Query, UseGuards } from '@nestjs/common';

import { assertEmptyBody } from '@common/pipes/empty-body';
import { Role } from '@generated/prisma/enums';
import { CurrentUser, RequireCurrentConsent } from '@modules/auth/auth.decorator';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { Roles } from '@modules/auth/roles.decorator';
import { RolesGuard } from '@modules/auth/roles.guard';
import { ReportEmptyInputDto, TutorReportResponseDto } from '@modules/reports/reports.dto';
import { ReportsService } from '@modules/reports/reports.service';
import { GetMyTutorReportDoc, ReportsControllerDoc } from '@modules/reports/reports.swagger';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';

@ReportsControllerDoc()
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('tutor/me')
  @Roles(Role.TUTOR)
  @RequireCurrentConsent()
  @Header('Cache-Control', 'no-store')
  @GetMyTutorReportDoc()
  getMyTutorReport(
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: ReportEmptyInputDto,
    @Body() body: ReportEmptyInputDto,
  ): Promise<TutorReportResponseDto> {
    void _query;
    assertEmptyBody(body, 'Tutor report accepts no request body');
    return this.reports.getTutorReport(user.id);
  }
}
