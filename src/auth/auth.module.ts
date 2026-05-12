import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { RedisModule } from '../redis/redis.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { TokenBlocklistService } from './services/token-blocklist.service';
import { JwtStrictStrategy } from './strategies/jwt-strict.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RefreshTokenCleanupTask } from './tasks/refresh-token-cleanup.task';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('auth.accessSecret'),
        signOptions: {
          algorithm: 'HS256',
          // Pass TTL as seconds — jsonwebtoken accepts numeric seconds and
          // sidesteps the strict template-literal typing of string forms.
          expiresIn: configService.getOrThrow<number>('auth.accessTtlSeconds'),
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
    UsersModule,
    RedisModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    RefreshTokenService,
    TokenBlocklistService,
    JwtStrategy,
    JwtStrictStrategy,
    RefreshTokenCleanupTask,
  ],
  exports: [AuthService, TokenBlocklistService],
})
export class AuthModule {}
