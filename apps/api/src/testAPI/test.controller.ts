import { Controller, Get, Query } from '@nestjs/common';
import {TestService} from '@/testAPI/test.service'
import { TestingToken } from '@clerk/backend';

@Controller('api/test')
export class TestController {
  constructor(private readonly testService: TestService) {}

  @Get()
  async getToken(): Promise<string> {
    const token = await this.testService.getTestToken();
    console.log(token);
    return token;
  }
}
