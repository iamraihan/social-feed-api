import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudinaryStorageService } from './cloudinary-storage.service';
import { ImageProcessor } from './image-processor.service';
import { LocalStorageService } from './local-storage.service';
import { StorageService } from './storage.service';

// Global because storage + image processing are cross-cutting concerns; only
// one StorageService impl is active at a time and the active impl is chosen
// at boot via the STORAGE_DRIVER env var:
//   - "cloudinary" (default) — production-style CDN delivery
//   - "local"                — disk fallback for offline dev / e2e
// Swapping no longer requires a code edit + rebuild.
@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      useFactory: (configService: ConfigService): StorageService => {
        const driver = (
          configService.get<string>('STORAGE_DRIVER') ?? 'cloudinary'
        ).toLowerCase();
        const logger = new Logger('StorageModule');
        switch (driver) {
          case 'local':
            logger.log('Storage driver: local disk');
            return new LocalStorageService(configService);
          case 'cloudinary':
            logger.log('Storage driver: cloudinary');
            return new CloudinaryStorageService(configService);
          default:
            // Boot-fail loudly rather than silently fall back — a typo in
            // STORAGE_DRIVER should not silently route uploads to the wrong
            // backend in production.
            throw new Error(
              `Unknown STORAGE_DRIVER="${driver}". Expected "cloudinary" or "local".`,
            );
        }
      },
      inject: [ConfigService],
    },
    ImageProcessor,
  ],
  exports: [StorageService, ImageProcessor],
})
export class StorageModule {}
