import { PublicUserDto } from '../../users/dto';

export class CommentDto {
  id!: string;
  postId!: string;
  // Null = top-level comment; non-null = reply (the id points to the parent).
  parentId!: string | null;
  content!: string;
  author!: PublicUserDto;
  // Number of replies (excluding soft-deleted). Always 0 for replies in our
  // 1-level-nesting model, but included on every row for response shape
  // consistency — frontends conditionally render the "View N replies" UI.
  replyCount!: number;
  // Populated by the likes module via batched queries on list reads.
  // Always present; 0 / false when no likes exist.
  likeCount!: number;
  hasLiked!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

// Same shape as CommentDto but plain-typed (no class) — used by PostsService
// to attach a preview comment to each PostDto without importing the class
// constructor (which would require either a circular dep or a transformer).
export type CommentSnapshot = Omit<CommentDto, 'createdAt' | 'updatedAt'> & {
  createdAt: Date;
  updatedAt: Date;
};

// Service-level return shape for paginated comment lists. Recognized by
// ResponseInterceptor and surfaced at the envelope's top level.
export class CommentListMeta {
  hasMore!: boolean;
  // The id to pass back as `?cursor=` for the next page. Null on the last page.
  nextCursor!: string | null;
  limit!: number;
}

export class CommentListDto {
  data!: CommentDto[];
  meta!: CommentListMeta;
}
