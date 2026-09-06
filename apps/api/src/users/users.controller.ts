import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {} from '@/users/users.dto';
import { UsersService } from '@/users/users.service';

@ApiTags('users')
@Controller('api/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('auth/:id')
  //   @GetTutorsDoc()
  async getCleckUserID(@Param('id') id: string): Promise<string | null> {
    return this.usersService.getCleckUserID(id);
  }
}
