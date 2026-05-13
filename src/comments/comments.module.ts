import { Module } from '@nestjs/common';
import { LikesModule } from '../likes/likes.module';
import { PostsModule } from '../posts/posts.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  imports: [
    // PostsService — post-visibility checks for create/list.
    PostsModule,
    // LikesService — populates likeCount / hasLiked on every comment read.
    // Module-level dependency is one-directional; LikesModule imports nothing
    // back (does its own target verification via direct Prisma access).
    LikesModule,
  ],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
