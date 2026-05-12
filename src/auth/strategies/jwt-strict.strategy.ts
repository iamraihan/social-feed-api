import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { TokenBlocklistService } from '../services/token-blocklist.service';
import type { JwtPayload } from './jwt.strategy';

// Strict strategy: signature + expiry + Redis blocklist check.
// Used on destructive / irreversible / sensitive routes.
@Injectable()
export class JwtStrictStrategy extends PassportStrategy(
  Strategy,
  'jwt-strict',
) {
  constructor(
    configService: ConfigService,
    private readonly blocklist: TokenBlocklistService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('auth.accessSecret'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (await this.blocklist.isBlocked(payload.jti, payload.sub)) {
      throw new UnauthorizedException('Token has been revoked');
    }
    return payload;
  }
}
