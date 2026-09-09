import { Controller, Get, UseGuards } from '@nestjs/common';

import { AppService } from '@/app.service';
import { AppControllerDoc } from '@/app.swagger';
import { JwtAuthGuard } from '@/auth/auth.guard';

@AppControllerDoc()
@Controller()
@UseGuards(JwtAuthGuard)
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
