import {
  Body,
  Controller,
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
  AvailabilityPrivateQueryDto,
  AvailabilityPrivateResponseDto,
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

import type { AuthenticatedUser } from '@/auth/auth.guard';

@TutorsControllerDoc()
@UseGuards(JwtAuthGuard, RolesGuard, ResourceOwnershipGuard)
@Roles(Role.TUTOR)
@Controller('tutors')
export class TutorsController {
  constructor(private readonly tutors: TutorsService) {}

  @Get('me/listings')
  @GetMyListingsDoc()
  getListings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListingQueryDto,
  ): Promise<ListingResponseDto[]> {
    return this.tutors.getListings(user.id, query);
  }

  @Post('me/listings')
  @PostListingDoc()
  postListing(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ListingPostRequestDto,
  ): Promise<ListingResponseDto> {
    return this.tutors.postListing(user.id, dto);
  }

  @Patch('me/listings/:listingId')
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

  @Post('me/listings/:listingId/publish')
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

  @Get('me/availability')
  @HttpCode(HttpStatus.OK)
  //TODO: swagger
  getAvailabilityPrivate(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AvailabilityPrivateQueryDto,
  ): Promise<AvailabilityPrivateResponseDto[]> {
    return this.tutors.getAvailabilityPrivate(user.id, query);
  }

  @Get('me/availability')
  @HttpCode(HttpStatus.OK)
  //TODO: swagger
  postAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: AvailabilityPostRequestDto,
  ): Promise<AvailabilityPostResponseDto> {
    return this.tutors.postAvailability(user.id, request);
  }
}
