import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtStrictAuthGuard } from '../auth/guards/jwt-strict-auth.guard';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { CommentsService } from './comments.service';
import { CreateCommentDto, ListCommentsQueryDto } from './dto';

// Routes span two base paths (`/posts/:postId/comments` and
// `/comments/...`) so the controller declares no base path — each handler's
// route is fully qualified. Single class keeps service injection clean.
@Controller()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  // 30 writes per IP per minute. Higher than posts (10/min) because comments
  // are a much higher-volume action; bots still get caught well below human
  // engagement rates.
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('posts/:postId/comments')
  @UseGuards(JwtStrictAuthGuard)
  async createForPost(
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.commentsService.createForPost(user.sub, postId, dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('comments/:commentId/replies')
  @UseGuards(JwtStrictAuthGuard)
  async createReply(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.commentsService.createReply(user.sub, commentId, dto);
  }

  @Get('posts/:postId/comments')
  @UseGuards(JwtAuthGuard)
  async listForPost(
    @Param('postId', ParseUUIDPipe) postId: string,
    @Query() query: ListCommentsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.commentsService.listForPost(postId, user.sub, query);
  }

  @Get('comments/:commentId/replies')
  @UseGuards(JwtAuthGuard)
  async listReplies(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Query() query: ListCommentsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.commentsService.listReplies(commentId, user.sub, query);
  }

  @Delete('comments/:id')
  @UseGuards(JwtStrictAuthGuard)
  @HttpCode(HttpStatus.OK)
  async softDelete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.commentsService.softDelete(id, user.sub);
  }
}
