import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  UploadApiErrorResponse,
  UploadApiResponse,
  v2 as cloudinary,
} from 'cloudinary';
import { randomUUID } from 'node:crypto';
import { SaveOptions, StorageService } from './storage.service';

@Injectable()
export class CloudinaryStorageService extends StorageService {
  private readonly logger = new Logger(CloudinaryStorageService.name);
  private readonly folder: string;

  constructor(configService: ConfigService) {
    super();
    cloudinary.config({
      cloud_name: configService.getOrThrow<string>('cloudinary.cloudName'),
      api_key: configService.getOrThrow<string>('cloudinary.apiKey'),
      api_secret: configService.getOrThrow<string>('cloudinary.apiSecret'),
      secure: true,
    });
    this.folder = configService.getOrThrow<string>('cloudinary.folder');
  }

  // Returned key is the Cloudinary public_id (e.g. "social-feed/posts/<uuid>").
  // No file extension — Cloudinary derives format from upload bytes and the
  // delivery URL can request a different one via `fetch_format`.
  save(buffer: Buffer, { prefix }: SaveOptions): Promise<string> {
    const publicId = `${this.folder}/${prefix}/${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: 'image',
          overwrite: false,
        },
        (
          error: UploadApiErrorResponse | undefined,
          result: UploadApiResponse | undefined,
        ) => {
          if (error || !result) {
            return reject(error ?? new Error('Cloudinary upload failed'));
          }
          resolve(result.public_id);
        },
      );
      stream.end(buffer);
    });
  }

  async delete(key: string): Promise<void> {
    // `invalidate: true` purges the CDN edge cache so the URL stops serving
    // the deleted asset immediately rather than waiting for TTL expiry.
    const result = (await cloudinary.uploader.destroy(key, {
      resource_type: 'image',
      invalidate: true,
    })) as { result: string };

    // "ok" = deleted, "not found" = already gone (treat as success, matches
    // LocalStorageService's ENOENT swallow). Anything else surfaces.
    if (result.result !== 'ok' && result.result !== 'not found') {
      this.logger.warn(
        `Cloudinary destroy returned "${result.result}" for key="${key}"`,
      );
    }
  }

  url(key: string | null): string | null {
    if (!key) return null;
    // f_auto / q_auto let Cloudinary serve AVIF/WebP and pick a quality level
    // per-client without us having to pre-encode variants.
    return cloudinary.url(key, {
      secure: true,
      fetch_format: 'auto',
      quality: 'auto',
    });
  }
}
