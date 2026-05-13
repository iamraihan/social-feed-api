import {
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
import { LikeTargetType } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ListLikersQueryDto } from './dto';
import { LikesService } from './likes.service';
import { ParseLikeTargetPipe } from './pipes/parse-like-target.pipe';

// 120/min/IP on writes — humans tap-tap the like button, and the operation
// is reversible + idempotent. Cap is high enough that double-tapping never
// gets throttled but a like-bomb script still gets caught.
//
// Light guard everywhere (not strict): likes are non-destructive, low-stakes.
// A revoked-but-not-expired token can still toggle a like for up to 15 min;
// fine trade-off vs hitting Redis on every like in a feed-scroll session.
@Controller('likes')
@UseGuards(JwtAuthGuard)
export class LikesController {
  constructor(private readonly likesService: LikesService) {}

  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Post(':type/:id')
  @HttpCode(HttpStatus.OK)
  async like(
    @Param('type', ParseLikeTargetPipe) type: LikeTargetType,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.likesService.like(user.sub, type, id);
    return { liked: true };
  }

  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Delete(':type/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlike(
    @Param('type', ParseLikeTargetPipe) type: LikeTargetType,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.likesService.unlike(user.sub, type, id);
  }

  @Get(':type/:id/users')
  async listLikers(
    @Param('type', ParseLikeTargetPipe) type: LikeTargetType,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListLikersQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.likesService.listLikers(type, id, user.sub, query);
  }
}
