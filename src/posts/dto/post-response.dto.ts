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

// Service-level return shape for paginated lists. The ResponseInterceptor
// detects { data, meta } and surfaces both at the top level of the envelope
// rather than nesting the whole object under `data`.
export class FeedMeta {
  hasMore!: boolean;
  // The id to pass back as `?cursor=` for the next page. Null on the last page.
  nextCursor!: string | null;
  limit!: number;
}

export class FeedDto {
  data!: PostDto[];
  meta!: FeedMeta;
}
