import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';

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
  @HttpCode(HttpStatus.OK)
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
    // Reject non-object JSON bodies (arrays/primitives) that bypass class-validator property whitelisting.
    if (
      body !== undefined &&
      (typeof body !== 'object' ||
        body === null ||
        Array.isArray(body) ||
        Object.keys(body).length !== 0)
    ) {
      throw new BadRequestException('Tutor report accepts no request body');
    }
    return this.reports.getTutorReport(user.id);
  }
}
