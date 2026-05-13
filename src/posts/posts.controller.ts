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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtStrictAuthGuard } from '../auth/guards/jwt-strict-auth.guard';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { CreatePostDto, FeedQueryDto } from './dto';
import { PostsService } from './posts.service';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  // 10 posts per IP per minute — humans don't post that fast; bots and spam
  // scripts do. Strict guard because this is destructive (creates content).
  // Multer config (size limit + MIME allow-list) is configured globally in
  // PostsModule via MulterModule.registerAsync; FileInterceptor picks it up.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post()
  @UseGuards(JwtStrictAuthGuard)
  @UseInterceptors(FileInterceptor('image'))
  async create(
    @Body() dto: CreatePostDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    // Map Express's Multer.File to our framework-agnostic UploadedImage so the
    // service stays free of Express/Multer types.
    const upload = file
      ? { buffer: file.buffer, mimetype: file.mimetype }
      : undefined;
    return this.postsService.create(user.sub, dto, upload);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async listFeed(
    @Query() query: FeedQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.postsService.listFeed(user.sub, query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.postsService.findOne(id, user.sub);
  }

  @Delete(':id')
  @UseGuards(JwtStrictAuthGuard)
  @HttpCode(HttpStatus.OK)
  async softDelete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.postsService.softDelete(id, user.sub);
  }
}
