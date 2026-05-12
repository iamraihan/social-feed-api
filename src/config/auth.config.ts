import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET,
  accessTtlSeconds:
    parseInt(process.env.ACCESS_TOKEN_TTL_SECONDS ?? '900', 10) || 900,
  refreshTtlDays: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS ?? '7', 10) || 7,
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
}));
