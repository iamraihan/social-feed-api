import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListLikersQueryDto {
  // The id of the LAST liker row the client already has (cursor pagination on
  // the like itself, not the user). Stable as the list grows.
  @IsOptional()
  @IsUUID()
  cursor?: string;

  // 100 max keeps payloads bounded; 20 default fits typical "who liked" UI.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
