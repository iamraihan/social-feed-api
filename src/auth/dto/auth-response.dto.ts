import { UserDto } from '../../users/dto';

// Returned by /auth/login, /auth/register, and /auth/refresh.
// The refresh token itself is NOT in the body — it lives in the httpOnly cookie.
export class AuthTokensDto {
  accessToken!: string;
  expiresIn!: number;
  user!: UserDto;
}

export class RefreshResponseDto {
  accessToken!: string;
  expiresIn!: number;
}
