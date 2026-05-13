import { Module } from '@nestjs/common';
import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';

// Notice: this module imports NOTHING. It deliberately does its own target
// verification via direct Prisma access (see LikesService.assertTargetVisible)
// rather than depending on PostsService / CommentsService.
//
// Why: PostsModule and CommentsModule both import LikesModule (so their
// services can populate likeCount + hasLiked on read paths). If LikesModule
// imported them back, we'd have circular module deps. Direct Prisma in
// LikesService is the cheapest break — small DRY duplication for clean wiring.
@Module({
  controllers: [LikesController],
  providers: [LikesService],
  exports: [LikesService],
})
export class LikesModule {}
