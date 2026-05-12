import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { hashRefreshToken } from '../utils/token.util';

interface IssueParams {
  userId: string;
  familyId: string;
  rawToken: string;
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class RefreshTokenService {
  private readonly refreshTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.refreshTtlDays = configService.getOrThrow<number>(
      'auth.refreshTtlDays',
    );
  }

  async issue({
    userId,
    familyId,
    rawToken,
    userAgent,
    ipAddress,
  }: IssueParams) {
    const expiresAt = new Date(
      Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000,
    );

    return this.prisma.db.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hashRefreshToken(rawToken),
        expiresAt,
        userAgent,
        ipAddress,
      },
    });
  }

  async findByRawToken(rawToken: string) {
    return this.prisma.db.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken) },
    });
  }

  async markUsed(id: string) {
    return this.prisma.db.refreshToken.update({
      where: { id },
      data: { used: true },
    });
  }

  // Reuse detected: kill the whole family in one statement.
  async revokeFamily(familyId: string) {
    return this.prisma.db.refreshToken.updateMany({
      where: { familyId, revoked: false },
      data: { revoked: true },
    });
  }

  // Triggered on logout-all, password change, ban, etc.
  async revokeAllForUser(userId: string) {
    return this.prisma.db.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  }

  // Called by the nightly cleanup cron.
  async pruneStale() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

    return this.prisma.db.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { revoked: true, createdAt: { lt: thirtyDaysAgo } },
          { used: true, createdAt: { lt: eightDaysAgo } },
        ],
      },
    });
  }
}
