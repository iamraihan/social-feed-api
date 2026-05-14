import { PostVisibility } from '@prisma/client';
import { CommentSnapshot } from '../../comments/dto';
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
  // Top-level comments on the post (replies excluded). Soft-deleted comments
  // are filtered via an explicit `where` on the `_count` relation — the
  // soft-delete extension only hooks top-level reads, _count subqueries
  // bypass it. Populated in the same SELECT as the post row, no extra query.
  commentCount!: number;
  // Most-recent top-level comment on this post, populated server-side so the
  // feed can show a single preview comment per card without a follow-up
  // fetch. Null when no top-level comments exist. Full list still requires
  // GET /posts/:id/comments (paginated) — this is just the preview seed.
  // Like state on the snapshot is computed for the viewer (hasLiked etc.).
  previewComment!: CommentSnapshot | null;
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
