import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  jti: string;
  role: string;
  iat: number;
  exp: number;
}

// Light strategy: signature + expiry only. No Redis hit. Used on read-mostly
// routes. The strict variant lives in jwt-strict.strategy.ts.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('auth.accessSecret'),
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
