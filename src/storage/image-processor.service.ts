import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

// Centralized image-processing presets. Each public method is a use-case-named
// transformation so call sites read clearly ("forPost", "forAvatar") and the
// numeric tuning (dimensions, quality, format) stays in one place rather than
// scattered across services.
//
// Concrete class (not abstract like StorageService) because sharp is the de
// facto standard and we don't need a swap path — every alternative (jimp,
// imagemagick) has the same primitives. If a future requirement forces a swap,
// promote this to an abstract base and add a concrete sub-class.
@Injectable()
export class ImageProcessor {
  // Defends against pixel bombs: a small uploaded file (e.g., 1MB) can decode
  // into a 100M-pixel image and OOM the worker. ~50M is generous for real
  // user content (~7000x7000) and rejects malicious oversized images early.
  private readonly MAX_INPUT_PIXELS = 50_000_000;

  // Feed-post tuning. 1080px max dim is what most social feeds render at;
  // larger costs bandwidth without visible UX gain. WebP@85 is the usual
  // sweet spot between filesize and visible artifacts.
  private readonly POST_MAX_DIMENSION = 1080;
  private readonly POST_WEBP_QUALITY = 85;

  async forPost(buffer: Buffer): Promise<Buffer> {
    return (
      sharp(buffer, { limitInputPixels: this.MAX_INPUT_PIXELS })
        // .rotate() reads EXIF orientation, applies it, then strips EXIF so we
        // don't leak GPS / device info from the original file.
        .rotate()
        // fit: 'inside' preserves aspect ratio; withoutEnlargement prevents
        // upscaling tiny source images into blurry larger ones.
        .resize({
          width: this.POST_MAX_DIMENSION,
          height: this.POST_MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: this.POST_WEBP_QUALITY })
        .toBuffer()
    );
  }

  // Future presets (forAvatar, forThumbnail, forBanner) land here so the
  // tuning numbers stay co-located with the pipeline that uses them.
}
