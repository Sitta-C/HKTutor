import { Controller, Get, Put, UseGuards, Res, HttpStatus, HttpCode, Body, BadRequestException, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '@/auth/auth.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorator';
import { ListingQueryDto, ListingResponseDto, TutorProfileResponseDto, TutorProfileUpdateQueryDto } from '@/tutors/tutors.dto';
import { TutorsService } from '@/tutors/tutors.service';
import { GetUser } from '@/user/get-user.decorator';

@ApiTags('tutors')
@Controller('api/tutors')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TUTOR')
export class TutorsController {
  constructor(private readonly tutorsService: TutorsService) {}

  //Profile
  @Get('me/profile')
  @HttpCode(HttpStatus.OK)
  async getProfile(@GetUser('userId') userId: string, @Res({ passthrough: true }) res: Response): Promise<TutorProfileResponseDto> {
    if(!userId) {
      throw new BadRequestException(`userId missing`)
    }
    return await this.tutorsService.getProfile(userId);
  }

  @Put('me/profile')
  @HttpCode(HttpStatus.OK)
  async putProfile(@GetUser('userId') userId: string, @Body() updateTutorProfileDto: TutorProfileUpdateQueryDto) {
    if(!userId) {
      throw new BadRequestException(`userId missing`)
    }
    return await this.tutorsService.putProfile(userId, updateTutorProfileDto);
  }

  //Listing
  @Get('me/listings')
  @HttpCode(HttpStatus.OK)
  async getListings(@GetUser('userId') userId: string, @Query() query: ListingQueryDto): Promise<ListingResponseDto[]> {
    if(!userId) {
      throw new BadRequestException(`userId missing`)
    }
    const response = await this.tutorsService.getListings(userId, query)
    return (response)? response : [];
  }
}
