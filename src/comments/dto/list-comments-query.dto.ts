import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListCommentsQueryDto {
  // The id of the LAST comment the client already has. Server returns rows
  // strictly older. Cursor over offset — stays fast as conversations grow.
  @IsOptional()
  @IsUUID()
  cursor?: string;

  // 50 max keeps payloads bounded; 20 default fits a typical comment viewport.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}
