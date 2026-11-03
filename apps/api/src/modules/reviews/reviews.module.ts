import { Module } from '@nestjs/common';

import { ReviewController, ReviewsController } from '@modules/reviews/reviews.controller';
import { ReviewsService } from '@modules/reviews/reviews.service';

@Module({
  controllers: [ReviewsController, ReviewController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
