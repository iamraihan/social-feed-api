import { Global, Module } from '@nestjs/common';
import { ImageProcessor } from './image-processor.service';
import { LocalStorageService } from './local-storage.service';
import { StorageService } from './storage.service';

// Global because storage + image processing are cross-cutting concerns; only
// one StorageService impl is active at a time and the impl is chosen here.
@Global()
@Module({
  providers: [
    { provide: StorageService, useClass: LocalStorageService },
    ImageProcessor,
  ],
  exports: [StorageService, ImageProcessor],
})
export class StorageModule {}
