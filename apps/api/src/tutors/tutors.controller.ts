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
  Query,
} from '@nestjs/common';

import { CurrentUser } from '@/auth/auth.decorator';
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
  ListingStatusRequestDto,
} from '@/tutors/tutors.dto';
import { TutorsService } from '@/tutors/tutors.service';
import {
  GetMyListingsDoc,
  GetMyListingDoc,
  PatchListingDoc,
  PostListingDoc,
  PublishListingDoc,
  UpdateListingStatusDoc,
  TutorsControllerDoc,
} from '@/tutors/tutors.swagger';

import type { AuthenticatedUser } from '@/auth/auth.guard';

@TutorsControllerDoc()
@Controller('tutors')
@UseGuards(JwtAuthGuard, RolesGuard, ResourceOwnershipGuard)
@Roles(Role.TUTOR)
export class TutorsController {
  constructor(private readonly tutorsService: TutorsService) {}

  //Listing
  @Get('me/listings')
  @HttpCode(HttpStatus.OK)
  @GetMyListingsDoc()
  async getListings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() request: ListingQueryDto,
  ): Promise<ListingResponseDto[]> {
    const response = await this.tutorsService.getListings(user.id, request);
    return response ? response : [];
  }

  @Get('me/listings/:listingId')
  @RequireOwnership({
    resource: 'teachingListing',
    idParam: 'listingId',
    allowAdmin: true,
  })
  @GetMyListingDoc()
  async getListing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId') listingId: string,
  ): Promise<ListingResponseDto> {
    if (!listingId) throw new BadRequestException('listingId missing');
    return this.tutorsService.getListing(user.id, listingId);
  }

  @Post('me/listings')
  @HttpCode(HttpStatus.CREATED)
  @PostListingDoc()
  async postListing(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: ListingPostRequestDto,
  ): Promise<string> {
    const response = await this.tutorsService.postListing(user.id, request);
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
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId') listingId: string,
    @Body() request: ListingPatchRequestDto,
  ): Promise<ListingResponseDto> {
    if (!listingId) {
      throw new BadRequestException(`listingId missing`);
    }
    const response = await this.tutorsService.patchListing(user.id, listingId, request);
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
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId') listingId: string,
  ) {
    if (!listingId) {
      throw new BadRequestException(`listingId missing`);
    }
    await this.tutorsService.postPublishListing(user.id, listingId);
    return;
  }

  @Patch('me/listings/:listingId/status')
  @RequireOwnership({
    resource: 'teachingListing',
    idParam: 'listingId',
    allowAdmin: true,
  })
  @UpdateListingStatusDoc()
  async updateListingStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId') listingId: string,
    @Body() request: ListingStatusRequestDto,
  ): Promise<ListingResponseDto> {
    if (!listingId) throw new BadRequestException('listingId missing');
    return this.tutorsService.updateListingStatus(user.id, listingId, request.publicationStatus);
  }
}
