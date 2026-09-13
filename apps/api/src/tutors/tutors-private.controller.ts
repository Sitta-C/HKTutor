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

import { CurrentUser } from '@/auth/auth.decorator';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { RequireOwnership } from '@/auth/ownership.decorator';
import { ResourceOwnershipGuard } from '@/auth/ownership.guard';
import { Roles } from '@/auth/roles.decorator';
import { RolesGuard } from '@/auth/roles.guard';
import { Role } from '@/generated/prisma/client';
import {
  AvailabilityPostRequestDto,
  AvailabilityPostResponseDto,
  AvailabilityQueryDto,
  AvailabilityPrivateResponseDto,
  ListingPatchRequestDto,
  ListingPostRequestDto,
  ListingQueryDto,
  ListingResponseDto,
  ListingStatusRequestDto,
} from '@/tutors/tutors.dto';
import { TutorsService } from '@/tutors/tutors.service';
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
} from '@/tutors/tutors.swagger';

import type { AuthenticatedUser } from '@/auth/auth.guard';

@TutorsControllerDoc()
@UseGuards(JwtAuthGuard, RolesGuard, ResourceOwnershipGuard)
@Roles(Role.TUTOR)
@Controller('tutors/me')
export class TutorsPrivateController {
  constructor(private readonly tutors: TutorsService) {}

  @Get('listings')
  @HttpCode(HttpStatus.OK)
  @GetMyListingsDoc()
  getListings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListingQueryDto,
  ): Promise<ListingResponseDto[]> {
    return this.tutors.getListings(user.id, query);
  }

  @Get('listings/:listingId')
  @HttpCode(HttpStatus.OK)
  @RequireOwnership({
    resource: 'teachingListing',
    idParam: 'listingId',
    allowAdmin: true,
  })
  @GetMyListingDoc()
  getListing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId') listingId: string,
  ): Promise<ListingResponseDto> {
    return this.tutors.getListing(user.id, listingId);
  }

  @Post('listings')
  @HttpCode(HttpStatus.CREATED)
  @PostListingDoc()
  postListing(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ListingPostRequestDto,
  ): Promise<ListingResponseDto> {
    return this.tutors.postListing(user.id, dto);
  }

  @Patch('listings/:listingId')
  @HttpCode(HttpStatus.OK)
  @RequireOwnership({
    resource: 'teachingListing',
    idParam: 'listingId',
    allowAdmin: true,
  })
  @PatchListingDoc()
  patchListing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId') listingId: string,
    @Body() dto: ListingPatchRequestDto,
  ): Promise<ListingResponseDto> {
    return this.tutors.patchListing(user.id, listingId, dto);
  }

  @Patch('listings/:listingId/status')
  @HttpCode(HttpStatus.OK)
  @RequireOwnership({
    resource: 'teachingListing',
    idParam: 'listingId',
    allowAdmin: true,
  })
  @UpdateListingStatusDoc()
  updateListingStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId') listingId: string,
    @Body() dto: ListingStatusRequestDto,
  ): Promise<ListingResponseDto> {
    return this.tutors.updateListingStatus(user.id, listingId, dto.publicationStatus);
  }

  @Post('listings/:listingId/publish')
  @HttpCode(HttpStatus.OK)
  @RequireOwnership({
    resource: 'teachingListing',
    idParam: 'listingId',
    allowAdmin: true,
  })
  @PublishListingDoc()
  postPublishListing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId') listingId: string,
  ): Promise<ListingResponseDto> {
    return this.tutors.postPublishListing(user.id, listingId);
  }

  @Get('availability')
  @HttpCode(HttpStatus.OK)
  @GetMyAvailabilityDoc()
  getAvailabilityPrivate(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AvailabilityQueryDto,
  ): Promise<AvailabilityPrivateResponseDto[]> {
    return this.tutors.getAvailabilityPrivate(user.id, query);
  }

  @Post('availability')
  @HttpCode(HttpStatus.CREATED)
  @PostAvailabilityDoc()
  postAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: AvailabilityPostRequestDto,
  ): Promise<AvailabilityPostResponseDto> {
    return this.tutors.postAvailability(user.id, request);
  }

  @Delete('availability/:slotId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireOwnership({
    resource: 'availabilitySlot',
    idParam: 'slotId',
    allowAdmin: true,
  })
  @DeleteAvailabilityDoc()
  deleteAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slotId') slotId: string,
  ): Promise<void> {
    return this.tutors.deleteAvailability(user.id, slotId);
  }
}
