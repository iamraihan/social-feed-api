import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
  maxImageSizeBytes:
    (parseInt(process.env.MAX_IMAGE_SIZE_MB ?? '5', 10) || 5) * 1024 * 1024,
}));
