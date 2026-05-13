import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  // PostsModule exports PostsService, used here for post-visibility checks.
  imports: [PostsModule],
  controllers: [CommentsController],
  providers: [CommentsService],
  // Exported so the future likes module integration can verify a comment
  // exists before allowing a like on it.
  exports: [CommentsService],
})
export class CommentsModule {}
