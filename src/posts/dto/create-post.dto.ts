import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PostVisibility } from '@prisma/client';

const trim = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePostDto {
  // 5000-char cap matches the DB column; min 1 prevents whitespace-only posts.
  @IsString()
  @MinLength(1, { message: 'Content cannot be empty' })
  @MaxLength(5000, { message: 'Content must not exceed 5000 characters' })
  @Transform(({ value }) => trim(value))
  content!: string;

  // Default to PUBLIC if the field is omitted. Multipart form bodies serialize
  // everything as strings, so class-validator + transform handle the cast.
  @IsOptional()
  @IsEnum(PostVisibility, {
    message: `visibility must be one of: ${Object.values(PostVisibility).join(', ')}`,
  })
  visibility?: PostVisibility = PostVisibility.PUBLIC;
}
