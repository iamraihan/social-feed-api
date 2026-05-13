import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const trim = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCommentDto {
  // 2000-char cap matches the DB column; min 1 prevents whitespace-only posts.
  @IsString()
  @MinLength(1, { message: 'Content cannot be empty' })
  @MaxLength(2000, { message: 'Content must not exceed 2000 characters' })
  @Transform(({ value }) => trim(value))
  content!: string;
}
