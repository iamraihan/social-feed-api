import { PublicUserDto } from '../../users/dto';

export class LikersListMeta {
  hasMore!: boolean;
  // Cursor = the last like row's id. Null on the final page.
  nextCursor!: string | null;
  limit!: number;
  // Total count of likers (single GROUP BY query, cached for the page life).
  total!: number;
}

export class LikersListDto {
  data!: PublicUserDto[];
  meta!: LikersListMeta;
}
