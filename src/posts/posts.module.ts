import { BadRequestException, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { LikesModule } from '../likes/likes.module';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

@Module({
  imports: [
    // LikesService is injected into PostsService to populate likeCount /
    // hasLiked on read paths. LikesModule deliberately imports nothing back —
    // see its docstring for why (avoiding a circular module dependency).
    LikesModule,
    // Wire multer defaults through ConfigService so a single env var
    // (MAX_IMAGE_SIZE_MB) drives both validation at boot and runtime limits.
    // Decorators evaluate before DI runs, so this is the only place where
    // multer's limits can actually be sourced from injected config.
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        storage: memoryStorage(),
        limits: {
          fileSize: configService.getOrThrow<number>(
            'storage.maxImageSizeBytes',
          ),
        },
        fileFilter: (_req, file, cb) => {
          if (!ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
            cb(
              new BadRequestException(
                `Unsupported image type: ${file.mimetype}. Allowed: ${Array.from(
                  ALLOWED_IMAGE_MIMES,
                ).join(', ')}`,
              ),
              false,
            );
            return;
          }
          cb(null, true);
        },
      }),
    }),
  ],
  controllers: [PostsController],
  providers: [PostsService],
  // Exported so the future comments module can use it (e.g., verify the post
  // exists before allowing a comment on it).
  exports: [PostsService],
})
export class PostsModule {}
