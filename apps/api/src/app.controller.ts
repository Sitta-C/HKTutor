import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { AppService } from '@/app.service';
import { ClerkAuthGuard } from '@/auth/auth.guard';
import { VerifyClerkTokenDoc } from '@/auth/auth.swagger';

@ApiTags('authentication')
@Controller()
@UseGuards(ClerkAuthGuard)
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @VerifyClerkTokenDoc()
  getHello(): string {
    return this.appService.getHello();
  }
}
