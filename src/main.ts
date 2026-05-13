import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import * as path from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Behind any reverse proxy (k8s ingress, nginx, Cloudflare, ELB), `req.ip`
  // is the proxy address unless we tell Express to honor X-Forwarded-For.
  // Without this, the rate limiter buckets every client together and one user
  // can lock out everyone else. The default of 1 trusts the first hop; bump
  // via env when deploying behind multiple proxies (ingress + service mesh).
  const trustedProxyHops = parseInt(process.env.TRUSTED_PROXY_HOPS ?? '1', 10);
  app.set(
    'trust proxy',
    Number.isFinite(trustedProxyHops) ? trustedProxyHops : 1,
  );

  // Standard security headers (X-Frame-Options, HSTS in prod, X-Content-Type
  // -Options, etc.). Defaults are sensible — only relax if a specific feature
  // breaks (rare for an API).
  app.use(helmet());

  // Required to parse the httpOnly refresh-token cookie at /auth/refresh.
  app.use(cookieParser());

  // Credentialed CORS for the SPA. In production, set CORS_ORIGIN to a
  // comma-separated allow-list. In dev, falling back to `true` reflects
  // whichever origin the browser sent — fine on localhost, never in prod.
  const corsAllowlist =
    process.env.CORS_ORIGIN?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  app.enableCors({
    credentials: true,
    origin: corsAllowlist.length > 0 ? corsAllowlist : true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Serve user-uploaded images from the local storage directory. Path matches
  // what LocalStorageService.url() builds (`/uploads/<key>`). In production
  // this would be replaced by a CDN serving from S3, but the URL shape stays
  // the same so frontend code doesn't change.
  //
  // Trade-off: this serves every uploaded file without auth — including images
  // attached to PRIVATE posts. Post visibility hides the post body and metadata
  // (a non-author gets 404 on GET /posts/:id), but the IMAGE URL itself is
  // public if leaked. This matches what Twitter/Instagram/Facebook do — image
  // privacy is via URL obscurity (random UUID filenames). True per-image auth
  // would require either signed URLs with TTL or a guarded /posts/:id/image
  // streaming endpoint; both are reasonable next steps for a stricter spec.
  const uploadDir = process.env.UPLOAD_DIR ?? './uploads';
  app.useStaticAssets(path.resolve(uploadDir), { prefix: '/uploads' });

  // Forward SIGTERM/SIGINT into Nest lifecycle hooks — needed so Prisma and
  // the Redis client close cleanly on container stop / k8s rolling restart.
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
