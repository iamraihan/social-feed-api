import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

enum NodeEnvironment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

// Fails fast at boot when any required env var is missing or malformed.
// Specifically guards against shipping with a weak JWT secret — that's the
// failure mode that's silently catastrophic in production.
class EnvironmentVariables {
  @IsEnum(NodeEnvironment)
  @IsOptional()
  NODE_ENV: NodeEnvironment = NodeEnvironment.Development;

  @IsNumber()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT: number = 3000;

  // ---- Database ----
  // Catch literal "undefined" / typo'd strings that pass plain @IsString.
  @IsUrl({
    protocols: ['postgresql', 'postgres'],
    require_tld: false,
    require_protocol: true,
  })
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_HOST!: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  POSTGRES_PORT!: number;

  @IsString()
  @IsNotEmpty()
  POSTGRES_USER!: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_PASSWORD!: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_DB!: string;

  // ---- JWT / Auth ----
  // HS256 with a short secret is trivially forgeable. 32 chars is the minimum
  // to be brute-force-safe; 64 chars (the default produced by openssl rand
  // -hex 64) is the production recommendation.
  @IsString()
  @MinLength(32, {
    message:
      'JWT_ACCESS_SECRET must be at least 32 characters (64 recommended). Generate one with: openssl rand -hex 64',
  })
  JWT_ACCESS_SECRET!: string;

  // 60s floor prevents "born expired" tokens; 24h ceiling caps the blast
  // radius of a leaked access token at the cost of a few extra refreshes.
  @IsNumber()
  @Min(60)
  @Max(86_400)
  ACCESS_TOKEN_TTL_SECONDS!: number;

  // 1-day floor matches the cleanup-cron's used-row retention; 90 days is the
  // longest sane refresh window before forcing re-login on inactive users.
  @IsNumber()
  @Min(1)
  @Max(90)
  REFRESH_TOKEN_TTL_DAYS!: number;

  // ---- Cookies ----
  @IsString()
  @IsOptional()
  COOKIE_DOMAIN?: string;

  // Kept as a literal string ('true' | 'false') rather than a real boolean —
  // class-transformer's `enableImplicitConversion` would otherwise coerce
  // "false" into Boolean("false") = true, silently disarming this safety check.
  // The auth config reads it the same way: `process.env.COOKIE_SECURE === 'true'`.
  @IsIn(['true', 'false'])
  @IsOptional()
  COOKIE_SECURE?: 'true' | 'false';

  // ---- Redis ----
  @IsString()
  @IsNotEmpty()
  REDIS_HOST!: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  REDIS_PORT!: number;

  @IsString()
  @IsNotEmpty()
  REDIS_PASSWORD!: string;

  // ---- CORS ----
  // Comma-separated list of allowed origins for credentialed requests.
  // Required in production; in dev we fall back to reflecting the request origin.
  @IsString()
  @IsOptional()
  CORS_ORIGIN?: string;
}

export function validateEnvironment(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('\n  - ');
    throw new Error(`Environment validation failed:\n  - ${messages}`);
  }

  // Cross-field production safety checks. These are silent footguns if missed:
  //   - COOKIE_SECURE=false in prod → refresh cookie travels in plaintext
  //   - CORS_ORIGIN empty in prod   → app reflects any origin with credentials
  // Either misconfig leaks auth cookies; refuse to boot rather than serve.
  if (validated.NODE_ENV === NodeEnvironment.Production) {
    const issues: string[] = [];
    if (validated.COOKIE_SECURE !== 'true') {
      issues.push('COOKIE_SECURE must be "true" in production');
    }
    if (!validated.CORS_ORIGIN || validated.CORS_ORIGIN.trim() === '') {
      issues.push(
        'CORS_ORIGIN must be set in production (comma-separated allow-list of origins)',
      );
    }
    if (issues.length > 0) {
      throw new Error(
        `Production environment safety check failed:\n  - ${issues.join('\n  - ')}`,
      );
    }
  }

  return validated;
}
