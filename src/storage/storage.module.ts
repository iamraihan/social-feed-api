import { Global, Module } from '@nestjs/common';
import { CloudinaryStorageService } from './cloudinary-storage.service';
import { ImageProcessor } from './image-processor.service';
import { StorageService } from './storage.service';

// Global because storage + image processing are cross-cutting concerns; only
// one StorageService impl is active at a time and the impl is chosen here.
// Swap to LocalStorageService for offline/local-only dev.
@Global()
@Module({
  providers: [
    { provide: StorageService, useClass: CloudinaryStorageService },
    ImageProcessor,
  ],
  exports: [StorageService, ImageProcessor],
})
export class StorageModule {}
