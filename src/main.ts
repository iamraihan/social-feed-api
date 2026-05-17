import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

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

  // Wrap every successful response in the canonical envelope { success,
  // timestamp, data, meta? }. Routes that return undefined keep an empty body
  // so 204 No Content still works correctly.
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Order matters — most-specific first. Prisma errors intercepted before
  // the generic HTTP filter sees them so callers get semantic codes
  // (CONFLICT, NOT_FOUND) instead of leaked Prisma codes (P2002, P2025).
  app.useGlobalFilters(new PrismaExceptionFilter(), new HttpExceptionFilter());

  // Image bytes are served by Cloudinary's CDN, not this process — no static
  // asset middleware needed. Image privacy is via URL obscurity (random UUID
  // public_ids); private-post bodies remain gated by the visibility checks on
  // GET /posts/:id. Signed URLs / a guarded streaming endpoint are the next
  // step if a stricter spec demands per-image auth.

  // Forward SIGTERM/SIGINT into Nest lifecycle hooks — needed so Prisma and
  // the Redis client close cleanly on container stop / k8s rolling restart.
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
