import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Role } from '@generated/prisma/client';
import { CurrentUser } from '@modules/auth/auth.decorator';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { RequireOwnership } from '@modules/auth/ownership.decorator';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { Roles } from '@modules/auth/roles.decorator';
import { RolesGuard } from '@modules/auth/roles.guard';
import { TutorAvailabilityService } from '@modules/tutors/tutor-availability.service';
import { TutorListingsService } from '@modules/tutors/tutor-listings.service';
import {
  AvailabilityPostRequestDto,
  AvailabilityPostResponseDto,
  AvailabilityPrivateQueryDto,
  AvailabilityPrivateResponseDto,
  ListingPatchRequestDto,
  ListingPostRequestDto,
  ListingQueryDto,
  ListingResponseDto,
  ListingStatusRequestDto,
} from '@modules/tutors/tutors.dto';
import {
  DeleteAvailabilityDoc,
  GetMyAvailabilityDoc,
  GetMyListingsDoc,
  GetMyListingDoc,
  PatchListingDoc,
  PostAvailabilityDoc,
  PostListingDoc,
  PublishListingDoc,
  TutorsControllerDoc,
  UpdateListingStatusDoc,
} from '@modules/tutors/tutors.swagger';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';

@TutorsControllerDoc()
@UseGuards(JwtAuthGuard, RolesGuard, ResourceOwnershipGuard)
@Roles(Role.TUTOR)
@Controller('tutors/me')
export class TutorsPrivateController {
  constructor(
    private readonly listings: TutorListingsService,
    private readonly availability: TutorAvailabilityService,
  ) {}

  @Get('listings')
  @HttpCode(HttpStatus.OK)
  @GetMyListingsDoc()
  getListings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListingQueryDto,
  ): Promise<ListingResponseDto[]> {
    return this.listings.getListings(user.id, query);
  }

  @Get('listings/:listingId')
  @HttpCode(HttpStatus.OK)
  @RequireOwnership({
    resource: 'teachingListing',
    idParam: 'listingId',
  })
  @GetMyListingDoc()
  getListing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId') listingId: string,
  ): Promise<ListingResponseDto> {
    return this.listings.getListing(user.id, listingId);
  }

  @Post('listings')
  @HttpCode(HttpStatus.CREATED)
  @PostListingDoc()
  postListing(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ListingPostRequestDto,
  ): Promise<ListingResponseDto> {
    return this.listings.postListing(user.id, dto);
  }

  @Patch('listings/:listingId')
  @HttpCode(HttpStatus.OK)
  @RequireOwnership({
    resource: 'teachingListing',
    idParam: 'listingId',
  })
  @PatchListingDoc()
  patchListing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId') listingId: string,
    @Body() dto: ListingPatchRequestDto,
  ): Promise<ListingResponseDto> {
    return this.listings.patchListing(user.id, listingId, dto);
  }

  @Patch('listings/:listingId/status')
  @HttpCode(HttpStatus.OK)
  @RequireOwnership({
    resource: 'teachingListing',
    idParam: 'listingId',
  })
  @UpdateListingStatusDoc()
  updateListingStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId') listingId: string,
    @Body() dto: ListingStatusRequestDto,
  ): Promise<ListingResponseDto> {
    return this.listings.updateListingStatus(user.id, listingId, dto.publicationStatus);
  }

  @Post('listings/:listingId/publish')
  @HttpCode(HttpStatus.OK)
  @RequireOwnership({
    resource: 'teachingListing',
    idParam: 'listingId',
  })
  @PublishListingDoc()
  postPublishListing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId') listingId: string,
  ): Promise<ListingResponseDto> {
    return this.listings.postPublishListing(user.id, listingId);
  }

  @Get('availability')
  @HttpCode(HttpStatus.OK)
  @GetMyAvailabilityDoc()
  getAvailabilityPrivate(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AvailabilityPrivateQueryDto,
  ): Promise<AvailabilityPrivateResponseDto[]> {
    return this.availability.getAvailabilityPrivate(user.id, query);
  }

  @Post('availability')
  @HttpCode(HttpStatus.CREATED)
  @PostAvailabilityDoc()
  postAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: AvailabilityPostRequestDto,
  ): Promise<AvailabilityPostResponseDto> {
    return this.availability.postAvailability(user.id, request);
  }

  @Delete('availability/:slotId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireOwnership({
    resource: 'availabilitySlot',
    idParam: 'slotId',
  })
  @DeleteAvailabilityDoc()
  deleteAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slotId') slotId: string,
  ): Promise<void> {
    return this.availability.deleteAvailability(user.id, slotId);
  }
}
