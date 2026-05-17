import { Injectable } from '@nestjs/common';
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
  // 30s ceiling on a single upload. A wedged Cloudinary edge would otherwise
  // pin the multer-held buffer in memory until Node's default socket timeout
  // (~2 min) — usable as a DoS surface on a /posts spam.
  private readonly UPLOAD_TIMEOUT_MS = 30_000;

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
          timeout: this.UPLOAD_TIMEOUT_MS,
        },
        (
          error: UploadApiErrorResponse | undefined,
          result: UploadApiResponse | undefined,
        ) => {
          if (error || !result) {
            // Cloudinary passes plain objects (UploadApiErrorResponse), not
            // Error instances. Wrapping preserves the message + http_code in
            // logs and routes the failure into the filter's Error branch.
            const wrapped = new Error(
              `Cloudinary upload failed: ${error?.message ?? 'unknown error'} (http=${error?.http_code ?? 'n/a'}, key=${publicId})`,
            );
            return reject(wrapped);
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
    const response = (await cloudinary.uploader.destroy(key, {
      resource_type: 'image',
      invalidate: true,
    })) as { result: string };

    // "ok" = deleted, "not found" = already gone (treat as success, matches
    // LocalStorageService's ENOENT swallow). Anything else is a real failure
    // — throw so the caller (or its .catch logger) sees it, matching Local's
    // contract of "propagate non-missing errors".
    if (response.result === 'ok' || response.result === 'not found') {
      return;
    }
    throw new Error(
      `Cloudinary destroy failed: result="${response.result}" key="${key}"`,
    );
  }

  url(key: string | null): string | null {
    if (!key) return null;
    // f_auto / q_auto let Cloudinary serve AVIF/WebP and pick a quality level
    // per-client without us having to pre-encode variants. `secure` is already
    // set globally in cloudinary.config — no need to repeat here.
    return cloudinary.url(key, {
      fetch_format: 'auto',
      quality: 'auto',
    });
  }
}
