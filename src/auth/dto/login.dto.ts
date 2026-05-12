import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

const normalizeEmail = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class LoginDto {
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @MaxLength(254)
  @Transform(({ value }) => normalizeEmail(value))
  email!: string;

  // No complexity rules on login — only registration enforces them. We just
  // need a non-empty string within the bcrypt range so a malformed body fails
  // at the boundary, not deep inside bcrypt.
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password!: string;
}
