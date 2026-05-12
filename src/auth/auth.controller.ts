import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { CreateUserDto } from '../users/dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService, type RequestContext } from './services/auth.service';
import type { JwtPayload } from './strategies/jwt.strategy';

const REFRESH_COOKIE_NAME = 'refresh_token';
// Limit the cookie scope to the auth subtree so it's not sent on every request.
// Reduces CSRF exposure: only /auth/refresh and /auth/logout will see it.
const REFRESH_COOKIE_PATH = '/auth';

// Express's `req.cookies` is typed as `any` by cookie-parser. Route it through
// `unknown` and narrow before use so no `any` escapes into our code paths.
function readCookie(req: Request, name: string): string | undefined {
  const jar = req.cookies as Record<string, unknown> | undefined;
  const value = jar?.[name];
  return typeof value === 'string' ? value : undefined;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  async register(
    @Body() dto: CreateUserDto,
    @Req() req: Request,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { tokens, refreshToken } = await this.authService.register(
      dto,
      this.requestContext(req, ip),
    );
    this.setRefreshCookie(res, refreshToken);
    return tokens;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { tokens, refreshToken } = await this.authService.login(
      dto.email,
      dto.password,
      this.requestContext(req, ip),
    );
    this.setRefreshCookie(res, refreshToken);
    return tokens;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieToken = readCookie(req, REFRESH_COOKIE_NAME);
    const { tokens, refreshToken } = await this.authService.refresh(
      cookieToken,
      this.requestContext(req, ip),
    );
    this.setRefreshCookie(res, refreshToken);
    // Strip the user envelope from refresh response — client already has it.
    const { user: _user, ...refreshPayload } = tokens;
    return refreshPayload;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieToken = readCookie(req, REFRESH_COOKIE_NAME);
    await this.authService.logout(cookieToken);
    this.clearRefreshCookie(res);
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logoutAll(user.sub);
    this.clearRefreshCookie(res);
  }

  private requestContext(req: Request, ip: string): RequestContext {
    return {
      userAgent: req.get('user-agent') ?? undefined,
      ipAddress: ip,
    };
  }

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: this.configService.get<boolean>('auth.cookieSecure', false),
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      domain: this.configService.get<string>('auth.cookieDomain'),
      maxAge:
        this.configService.getOrThrow<number>('auth.refreshTtlDays') *
        24 *
        60 *
        60 *
        1000,
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE_NAME, {
      path: REFRESH_COOKIE_PATH,
      domain: this.configService.get<string>('auth.cookieDomain'),
    });
  }
}
