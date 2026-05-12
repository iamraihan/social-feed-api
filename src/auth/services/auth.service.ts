import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { CreateUserDto, UserDto } from '../../users/dto';
import { UsersService } from '../../users/users.service';
import { AuthTokensDto } from '../dto';
import type { JwtPayload } from '../strategies/jwt.strategy';
import { generateRefreshToken } from '../utils/token.util';
import { RefreshTokenService } from './refresh-token.service';
import { TokenBlocklistService } from './token-blocklist.service';

export interface RequestContext {
  userAgent?: string;
  ipAddress?: string;
}

export interface AuthSession {
  tokens: AuthTokensDto;
  refreshToken: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessTtlSeconds: number;

  // Constant-time guard for failed logins: bcrypt against this dummy hash keeps
  // timing identical between unknown emails and bad passwords. Built at boot
  // so we never commit a real-looking bcrypt vector to source.
  private dummyHash!: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly blocklist: TokenBlocklistService,
    private readonly jwt: JwtService,
    configService: ConfigService,
  ) {
    this.accessTtlSeconds = configService.getOrThrow<number>(
      'auth.accessTtlSeconds',
    );
  }

  async onModuleInit() {
    this.dummyHash = await bcrypt.hash(randomUUID(), 10);
  }

  async register(
    dto: CreateUserDto,
    ctx: RequestContext,
  ): Promise<AuthSession> {
    const user = await this.usersService.create(dto);
    return this.startSession(user, ctx);
  }

  async login(
    email: string,
    password: string,
    ctx: RequestContext,
  ): Promise<AuthSession> {
    const record = await this.usersService.findByEmailWithPassword(email);

    // Always run bcrypt so timing is identical between unknown email and bad
    // password — prevents email-enumeration via response-time analysis.
    const ok = await bcrypt.compare(
      password,
      record?.password ?? this.dummyHash,
    );

    if (!record || !ok || record.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { password: _pw, ...user } = record;
    return this.startSession(user, ctx);
  }

  async refresh(
    rawToken: string | undefined,
    ctx: RequestContext,
  ): Promise<AuthSession> {
    if (!rawToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const record = await this.refreshTokens.findByRawToken(rawToken);

    if (!record || record.revoked || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // 🚨 Reuse detection: a token already marked `used` is presented again.
    // Either the legitimate client is racing itself, or an attacker copied
    // the token. Treat as compromise: revoke the family, blocklist the user
    // for the access-token lifetime, force re-login.
    //
    // Log the event with full forensic context. In production this line is
    // the hook for security alerting (Sentry / PagerDuty / SIEM).
    if (record.used) {
      // Logged at ERROR level (not warn) — this is a compromise indicator,
      // not a routine event. Production log aggregators page on-call for
      // errors but typically not for warnings.
      this.logger.error(
        `[SECURITY] refresh_token_reuse_detected ` +
          `family=${record.familyId} user=${record.userId} ` +
          `ip=${ctx.ipAddress ?? 'unknown'} ` +
          `ua=${JSON.stringify(ctx.userAgent ?? 'unknown')}`,
      );
      await this.refreshTokens.revokeFamily(record.familyId);
      await this.blocklist.blockUser(record.userId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    // Narrow the catch to NotFoundException so transient DB errors surface as
    // 500 instead of being misdiagnosed as "account inactive".
    const user = await this.usersService.findById(record.userId).catch((e) => {
      if (e instanceof NotFoundException) return null;
      throw e;
    });
    if (!user || user.status !== 'ACTIVE') {
      await this.refreshTokens.revokeFamily(record.familyId);
      throw new UnauthorizedException('Account is no longer active');
    }

    await this.refreshTokens.markUsed(record.id);
    return this.rotateSession(user, record.familyId, ctx);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const record = await this.refreshTokens.findByRawToken(rawToken);
    if (record && !record.revoked) {
      await this.refreshTokens.revokeFamily(record.familyId);
    }
  }

  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId);
    await this.blocklist.blockUser(userId);
  }

  // ---------- session minting ----------

  private async startSession(
    user: UserDto,
    ctx: RequestContext,
  ): Promise<AuthSession> {
    const familyId = randomUUID();
    return this.issueTokens(user, familyId, ctx);
  }

  private async rotateSession(
    user: UserDto,
    familyId: string,
    ctx: RequestContext,
  ): Promise<AuthSession> {
    return this.issueTokens(user, familyId, ctx);
  }

  private async issueTokens(
    user: UserDto,
    familyId: string,
    ctx: RequestContext,
  ): Promise<AuthSession> {
    const refreshToken = generateRefreshToken();

    await this.refreshTokens.issue({
      userId: user.id,
      familyId,
      rawToken: refreshToken,
      userAgent: ctx.userAgent,
      ipAddress: ctx.ipAddress,
    });

    const accessToken = this.signAccessToken(user.id);

    return {
      tokens: {
        accessToken,
        expiresIn: this.accessTtlSeconds,
        user,
      },
      refreshToken,
    };
  }

  private signAccessToken(userId: string): string {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: userId,
      jti: randomUUID(),
      role: 'user',
    };
    // expiresIn comes from JwtModule.signOptions — no need to repeat it here.
    return this.jwt.sign(payload);
  }
}
