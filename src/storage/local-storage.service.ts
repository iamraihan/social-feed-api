import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { SaveOptions, StorageService } from './storage.service';

@Injectable()
export class LocalStorageService extends StorageService {
  private readonly baseDir: string;
  private readonly publicBaseUrl: string;

  constructor(configService: ConfigService) {
    super();
    this.baseDir = configService.getOrThrow<string>('storage.uploadDir');
    this.publicBaseUrl = configService
      .getOrThrow<string>('storage.publicBaseUrl')
      .replace(/\/$/, '');
  }

  async save(buffer: Buffer, { prefix, ext }: SaveOptions): Promise<string> {
    // Random filename — never trust the user's original name (path traversal,
    // weird extensions, collisions).
    const filename = `${randomUUID()}.${ext}`;
    const key = `${prefix}/${filename}`;
    const fullPath = path.join(this.baseDir, key);

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);

    return key;
  }

  async delete(key: string): Promise<void> {
    const fullPath = path.join(this.baseDir, key);
    try {
      await fs.unlink(fullPath);
    } catch (error) {
      // Already-missing file is fine; anything else propagates.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  url(key: string | null): string | null {
    return key ? `${this.publicBaseUrl}/uploads/${key}` : null;
  }
}
