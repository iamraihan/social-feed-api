import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

// TTL on every blocklist entry matches the access-token lifetime — once the
// access token would have expired naturally there is nothing left to block.
@Injectable()
export class TokenBlocklistService {
  private readonly ttlSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    configService: ConfigService,
  ) {
    this.ttlSeconds = configService.getOrThrow<number>('auth.accessTtlSeconds');
  }

  async blockJti(jti: string): Promise<void> {
    await this.redis.set(`blocklist:jti:${jti}`, '1', 'EX', this.ttlSeconds);
  }

  async blockUser(userId: string): Promise<void> {
    await this.redis.set(
      `blocklist:user:${userId}`,
      '1',
      'EX',
      this.ttlSeconds,
    );
  }

  async isBlocked(jti: string, userId: string): Promise<boolean> {
    const [jtiHit, userHit] = await this.redis.mget(
      `blocklist:jti:${jti}`,
      `blocklist:user:${userId}`,
    );
    return jtiHit !== null || userHit !== null;
  }
}
