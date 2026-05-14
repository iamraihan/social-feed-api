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
  // Populated by the likes module via batched queries on list reads, single
  // queries on detail reads. Always present; 0 / false when no likes exist.
  likeCount!: number;
  hasLiked!: boolean;
  // Top 3 most recent likers, embedded so the feed renders the "who liked"
  // stack without an N+1 follow-up call per post. Empty array when no one
  // has liked yet. Populated by LikesService.getTopLikersForTargets via
  // a single window-function query for the whole page.
  topLikers!: PublicUserDto[];
  createdAt!: Date;
  updatedAt!: Date;
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
