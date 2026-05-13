import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LikeTargetType, Prisma } from '@prisma/client';
import { LikesService } from '../likes/likes.service';
import { PrismaService } from '../prisma/prisma.service';
import { PostsService } from '../posts/posts.service';
import { PUBLIC_USER_SELECT } from '../users/users.service';
import {
  CommentDto,
  CommentListDto,
  CreateCommentDto,
  ListCommentsQueryDto,
} from './dto';

// Shared select shape with replyCount derived from a filtered _count. The
// `where: { status: 'ACTIVE' }` on the relation count is critical — our
// soft-delete extension only hooks the top-level read; _count subqueries
// bypass it and would otherwise inflate counts with soft-deleted replies.
// authorId and status are deliberately omitted — neither appears in the
// response DTO, and the soft-delete extension already filters DELETED rows
// before the mapper sees them.
const COMMENT_SELECT = {
  id: true,
  postId: true,
  parentId: true,
  content: true,
  createdAt: true,
  updatedAt: true,
  author: { select: PUBLIC_USER_SELECT },
  _count: {
    select: {
      replies: { where: { status: 'ACTIVE' } },
    },
  },
} satisfies Prisma.CommentSelect;

// Per-row like state. Defaults applied at the mapper so create paths can pass
// nothing and still get a complete DTO shape.
interface LikeState {
  likeCount: number;
  hasLiked: boolean;
}

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly postsService: PostsService,
    private readonly likes: LikesService,
  ) {}

  async createForPost(
    authorId: string,
    postId: string,
    dto: CreateCommentDto,
  ): Promise<CommentDto> {
    // Visibility check — also confirms the post exists. Private posts the
    // viewer can't see throw 404, same as the posts endpoint.
    await this.postsService.assertVisible(postId, authorId);

    const created = await this.prisma.db.comment.create({
      data: { postId, authorId, content: dto.content, parentId: null },
      select: COMMENT_SELECT,
    });
    // Brand-new comment: likeCount=0, hasLiked=false. No need to ask likes.
    return this.toCommentDto(created);
  }

  async createReply(
    authorId: string,
    parentCommentId: string,
    dto: CreateCommentDto,
  ): Promise<CommentDto> {
    // Join the post in this same lookup so the visibility check below is
    // "free" — saves a DB round-trip vs calling postsService.assertVisible
    // separately. The two fields are tiny; the JOIN is cheaper than a second
    // network roundtrip.
    const parent = await this.prisma.db.comment.findUnique({
      where: { id: parentCommentId },
      select: {
        id: true,
        postId: true,
        parentId: true,
        post: { select: { authorId: true, visibility: true } },
      },
    });

    if (!parent) throw new NotFoundException('Comment not found');

    // Enforce one level of nesting. Spec doesn't ask for multi-level threads;
    // flattening here keeps the API simple and the UI predictable.
    if (parent.parentId !== null) {
      throw new BadRequestException('Cannot reply to a reply');
    }

    // Inline post-visibility check — same 404 semantics as assertVisible.
    if (
      parent.post.visibility === 'PRIVATE' &&
      parent.post.authorId !== authorId
    ) {
      throw new NotFoundException('Comment not found');
    }

    const reply = await this.prisma.db.comment.create({
      data: {
        postId: parent.postId,
        authorId,
        content: dto.content,
        parentId: parent.id,
      },
      select: COMMENT_SELECT,
    });
    return this.toCommentDto(reply);
  }

  async listForPost(
    postId: string,
    viewerId: string,
    query: ListCommentsQueryDto,
  ): Promise<CommentListDto> {
    await this.postsService.assertVisible(postId, viewerId);

    const { cursor, limit } = query;

    const rows = await this.prisma.db.comment.findMany({
      where: { postId, parentId: null },
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      select: COMMENT_SELECT,
    });

    return this.toPaginated(rows, limit, viewerId, 'COMMENT');
  }

  async listReplies(
    parentCommentId: string,
    viewerId: string,
    query: ListCommentsQueryDto,
  ): Promise<CommentListDto> {
    // Same JOIN trick as createReply — saves the separate assertVisible call.
    const parent = await this.prisma.db.comment.findUnique({
      where: { id: parentCommentId },
      select: {
        postId: true,
        parentId: true,
        post: { select: { authorId: true, visibility: true } },
      },
    });

    if (!parent) throw new NotFoundException('Comment not found');
    if (parent.parentId !== null) {
      throw new BadRequestException(
        'Replies can only be listed on top-level comments',
      );
    }
    if (
      parent.post.visibility === 'PRIVATE' &&
      parent.post.authorId !== viewerId
    ) {
      throw new NotFoundException('Comment not found');
    }

    const { cursor, limit } = query;

    const rows = await this.prisma.db.comment.findMany({
      where: { parentId: parentCommentId },
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      select: COMMENT_SELECT,
    });

    return this.toPaginated(rows, limit, viewerId, 'REPLY');
  }

  async softDelete(id: string, requesterId: string): Promise<CommentDto> {
    const comment = await this.prisma.db.comment.findUnique({
      where: { id },
      select: { id: true, authorId: true, parentId: true },
    });

    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== requesterId) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    // Soft-delete only the target row. Replies stay ACTIVE and remain fetchable
    // via /comments/:id/replies — the UI shows a "[deleted]" placeholder for
    // the parent while the conversation thread remains intact.
    const updated = await this.prisma.db.comment.update({
      where: { id },
      data: { status: 'DELETED' },
      select: COMMENT_SELECT,
    });

    // Type is determined by parent_id: null → COMMENT, non-null → REPLY.
    // Likes survive soft-delete (no FK cascade on polymorphic target_id),
    // so report the actual current state in the response.
    const targetType: LikeTargetType =
      comment.parentId === null ? 'COMMENT' : 'REPLY';
    const [likeCount, hasLiked] = await Promise.all([
      this.likes.countByTarget(targetType, id),
      this.likes.hasUserLiked(requesterId, targetType, id),
    ]);

    return this.toCommentDto(updated, { likeCount, hasLiked });
  }

  // ---------- internals ----------

  // N+1 protection: batch both like lookups in parallel for the entire page.
  // Result: 2 extra queries total regardless of page size — not 2N.
  private async toPaginated(
    rows: Array<Prisma.CommentGetPayload<{ select: typeof COMMENT_SELECT }>>,
    limit: number,
    viewerId: string,
    targetType: LikeTargetType,
  ): Promise<CommentListDto> {
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, -1) : rows;

    const commentIds = sliced.map((r) => r.id);
    const [likeCounts, likedIds] = await Promise.all([
      this.likes.getLikeCountsForTargets(targetType, commentIds),
      this.likes.getLikedTargetIdsForUser(viewerId, targetType, commentIds),
    ]);

    const items = sliced.map((r) =>
      this.toCommentDto(r, {
        likeCount: likeCounts.get(r.id) ?? 0,
        hasLiked: likedIds.has(r.id),
      }),
    );

    return {
      data: items,
      meta: {
        hasMore,
        nextCursor: hasMore ? items[items.length - 1].id : null,
        limit,
      },
    };
  }

  private toCommentDto(
    row: Prisma.CommentGetPayload<{ select: typeof COMMENT_SELECT }>,
    likeState: LikeState = { likeCount: 0, hasLiked: false },
  ): CommentDto {
    return {
      id: row.id,
      postId: row.postId,
      parentId: row.parentId,
      content: row.content,
      author: row.author,
      replyCount: row._count.replies,
      likeCount: likeState.likeCount,
      hasLiked: likeState.hasLiked,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
