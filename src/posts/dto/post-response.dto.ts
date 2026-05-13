import { PostVisibility } from '@prisma/client';
import { PublicUserDto } from '../../users/dto';

export class PostDto {
  id!: string;
  content!: string;
  // Raw storage key (durable; survives infra/CDN changes).
  imageKey!: string | null;
  // Pre-built URL the client can drop straight into <img src>. Null mirrors imageKey.
  imageUrl!: string | null;
  visibility!: PostVisibility;
  author!: PublicUserDto;
  createdAt!: Date;
  updatedAt!: Date;
  // likeCount and hasLiked are intentionally absent. They'll be populated by
  // the likes module when it's wired into the feed query in a later PR.
}

export class FeedDto {
  items!: PostDto[];
  hasMore!: boolean;
  // The id to pass back as `?cursor=` for the next page. Null on the last page.
  nextCursor!: string | null;
}
