import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class FeedQueryDto {
  // The id of the LAST post the client already has. Server returns rows
  // strictly older than this. Cursor pagination is preferred over offset at
  // scale — offset gets slower as you page deeper.
  @IsOptional()
  @IsUUID()
  cursor?: string;

  // 50 max keeps payloads bounded; 20 default fits the typical feed viewport.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}
