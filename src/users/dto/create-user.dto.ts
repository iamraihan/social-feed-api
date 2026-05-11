import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Non-string inputs pass through unchanged so the validator (not the transformer)
// raises the type error with a clear message.
const trim = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateUserDto {
  @IsString()
  @MinLength(1, { message: 'First name is required' })
  @MaxLength(80, { message: 'First name must not exceed 80 characters' })
  @Transform(({ value }) => trim(value))
  firstName!: string;

  @IsString()
  @MinLength(1, { message: 'Last name is required' })
  @MaxLength(80, { message: 'Last name must not exceed 80 characters' })
  @Transform(({ value }) => trim(value))
  lastName!: string;

  @IsEmail({}, { message: 'Email must be a valid email address' })
  @MaxLength(254, { message: 'Email must not exceed 254 characters' })
  @Transform(({ value }) => normalizeEmail(value))
  email!: string;

  // bcrypt truncates input past 72 bytes — reject rather than silently truncate.
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72, { message: 'Password must not exceed 72 characters' })
  @Matches(/[A-Z]/, { message: 'Password must contain an uppercase letter' })
  @Matches(/[a-z]/, { message: 'Password must contain a lowercase letter' })
  @Matches(/[0-9]/, { message: 'Password must contain a digit' })
  @Matches(/[^A-Za-z0-9]/, { message: 'Password must contain a symbol' })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  avatarKey?: string;
}
