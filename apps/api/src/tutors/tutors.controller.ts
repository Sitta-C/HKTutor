import {
  Controller,
  Get,
  UseGuards,
  HttpStatus,
  HttpCode,
  Body,
  BadRequestException,
  Post,
  Patch,
  Param,
} from '@nestjs/common';

import { JwtAuthGuard } from '@/auth/auth.guard';
import { RequireOwnership } from '@/auth/ownership.decorator';
import { ResourceOwnershipGuard } from '@/auth/ownership.guard';
import { Roles } from '@/auth/roles.decorator';
import { RolesGuard } from '@/auth/roles.guard';
import { Role } from '@/generated/prisma/client';
import {
  ListingPatchRequestDto,
  ListingPostRequestDto,
  ListingQueryDto,
  ListingResponseDto,
} from '@/tutors/tutors.dto';
import { TutorsService } from '@/tutors/tutors.service';
import {
  GetMyListingsDoc,
  PatchListingDoc,
  PostListingDoc,
  PublishListingDoc,
  TutorsControllerDoc,
} from '@/tutors/tutors.swagger';
import { GetUser } from '@/user/get-user.decorator';

@TutorsControllerDoc()
@Controller('api/tutors')
@UseGuards(JwtAuthGuard, RolesGuard, ResourceOwnershipGuard)
@Roles(Role.TUTOR)
export class TutorsController {
  constructor(private readonly tutorsService: TutorsService) {}

  //Listing
  @Get('me/listings')
  @HttpCode(HttpStatus.OK)
  @GetMyListingsDoc()
  async getListings(
    @GetUser('userId') userId: string,
    @Body() request: ListingQueryDto,
  ): Promise<ListingResponseDto[]> {
    if (!userId) {
      throw new BadRequestException(`userId missing`);
    }
    const response = await this.tutorsService.getListings(userId, request);
    return response ? response : [];
  }

  @Post('me/listings')
  @HttpCode(HttpStatus.CREATED)
  @PostListingDoc()
  async postListing(
    @GetUser('userId') userId: string,
    @Body() request: ListingPostRequestDto,
  ): Promise<string> {
    if (!userId) {
      throw new BadRequestException(`userId missing`);
    }
    const response = await this.tutorsService.postListing(userId, request);
    return response;
  }

  @Patch('me/listings/:listingId')
  @HttpCode(HttpStatus.OK)
  @RequireOwnership({
    resource: 'teachingListing',
    idParam: 'listingId',
    allowAdmin: true,
  })
  @PatchListingDoc()
  async patchListing(
    @GetUser('userId') userId: string,
    @Param('listingId') listingId: string,
    @Body() request: ListingPatchRequestDto,
  ): Promise<ListingResponseDto> {
    if (!userId) {
      throw new BadRequestException(`userId missing`);
    }
    if (!listingId) {
      throw new BadRequestException(`listingId missing`);
    }
    const response = await this.tutorsService.patchListing(userId, listingId, request);
    return response;
  }

  @Post('me/listings/:listingId/publish')
  @HttpCode(HttpStatus.OK)
  @RequireOwnership({
    resource: 'teachingListing',
    idParam: 'listingId',
    allowAdmin: true,
  })
  @PublishListingDoc()
  async postPublishListing(
    @GetUser('userId') userId: string,
    @Param('listingId') listingId: string,
  ) {
    if (!userId) {
      throw new BadRequestException(`userId missing`);
    }
    if (!listingId) {
      throw new BadRequestException(`listingId missing`);
    }
    await this.tutorsService.postPublishListing(userId, listingId);
    return;
  }
}
