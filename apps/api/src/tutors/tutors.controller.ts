import { Controller, Get, Put, UseGuards, HttpStatus, HttpCode, Body, BadRequestException, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '@/auth/auth.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorator';
import { ListingPostRequestDto, ListingQueryDto, ListingResponseDto, TutorProfileResponseDto, TutorProfileUpdateQueryDto } from '@/tutors/tutors.dto';
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
  async getProfile(@GetUser('userId') userId: string): Promise<TutorProfileResponseDto> {
    if(!userId) {
      throw new BadRequestException(`userId missing`)
    }
    return await this.tutorsService.getProfile(userId);
  }

  @Put('me/profile')
  @HttpCode(HttpStatus.OK)
  async putProfile(@GetUser('userId') userId: string, @Body() request: TutorProfileUpdateQueryDto) {
    if(!userId) {
      throw new BadRequestException(`userId missing`)
    }
    return await this.tutorsService.putProfile(userId, request);
  }

  //Listing
  @Get('me/listings')
  @HttpCode(HttpStatus.OK)
  async getListings(@GetUser('userId') userId: string, @Body() request: ListingQueryDto): Promise<ListingResponseDto[]> {
    if(!userId) {
      throw new BadRequestException(`userId missing`)
    }
    const response = await this.tutorsService.getListings(userId, request);
    return (response)? response : [];
  }

  @Post('me/listings')
  @HttpCode(HttpStatus.CREATED)
  async postListings(@GetUser('userId') userId: string, @Body() request: ListingPostRequestDto): Promise<string> {
    if(!userId) {
      throw new BadRequestException(`userId missing`)
    }
    const response = await this.tutorsService.postListing(userId, request);
    return response;
  }
}
