import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly postsService: PostsService,
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
    // Private posts the viewer can't see surface as "not found" so existence
    // doesn't leak via response code.
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
    // Same visibility rule as readers of the post itself — private = 404.
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

    return this.toPaginated(rows, limit);
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

    return this.toPaginated(rows, limit);
  }

  async softDelete(id: string, requesterId: string): Promise<CommentDto> {
    const comment = await this.prisma.db.comment.findUnique({
      where: { id },
      select: { id: true, authorId: true },
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

    return this.toCommentDto(updated);
  }

  // ---------- internals ----------

  private toPaginated(
    rows: Array<Prisma.CommentGetPayload<{ select: typeof COMMENT_SELECT }>>,
    limit: number,
  ): CommentListDto {
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, -1) : rows).map((r) =>
      this.toCommentDto(r),
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
  ): CommentDto {
    return {
      id: row.id,
      postId: row.postId,
      parentId: row.parentId,
      content: row.content,
      author: row.author,
      replyCount: row._count.replies,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
