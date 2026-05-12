import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RefreshTokenService } from '../services/refresh-token.service';

// Nightly retirement of expired / revoked / consumed refresh tokens. Used rows
// are kept 8 days to preserve the reuse-detection trip-wire window.
@Injectable()
export class RefreshTokenCleanupTask {
  private readonly logger = new Logger(RefreshTokenCleanupTask.name);

  constructor(private readonly refreshTokens: RefreshTokenService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneExpired() {
    const start = Date.now();
    const result = await this.refreshTokens.pruneStale();
    this.logger.log(
      `Pruned ${result.count} stale refresh tokens in ${Date.now() - start}ms`,
    );
  }
}
