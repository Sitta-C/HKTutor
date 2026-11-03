import { Module } from '@nestjs/common';

import {
  ReviewController,
  ReviewsController,
  TutorReviewsController,
} from '@modules/reviews/reviews.controller';
import { ReviewsService } from '@modules/reviews/reviews.service';

@Module({
  controllers: [ReviewsController, ReviewController, TutorReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
