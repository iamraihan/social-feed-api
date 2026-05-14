import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CommentSnapshot } from '../comments/dto';
import { LikesService } from '../likes/likes.service';
import { ImageProcessor } from '../storage/image-processor.service';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { PublicUserDto } from '../users/dto';
import { PUBLIC_USER_SELECT } from '../users/users.service';
import { CreatePostDto, FeedDto, FeedQueryDto, PostDto } from './dto';

// Framework-agnostic upload shape. The controller maps Express.Multer.File to
// this; the service never imports Express or Multer types. Makes the service
// testable without HTTP fixtures and survives swapping the transport layer.
export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
}

// Per-row like state attached to a PostDto. Defaulted to 0 / false / [] at
// the mapper so callers can omit it for paths where likes are irrelevant
// (newly-created posts, etc.). `previewComment` defaults to null — fresh
// posts have no comments yet.
interface LikeState {
  likeCount: number;
  hasLiked: boolean;
  topLikers: PostDto['topLikers'];
  previewComment: CommentSnapshot | null;
}

// Raw window-function row returned by getPreviewCommentsForPosts. JSON-encoded
// author keeps the SQL to one round-trip — same pattern as the topLikers query.
interface PreviewCommentRow {
  postId: string;
  id: string;
  parentId: string | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  author: PublicUserDto;
}

// Shared selection shape: every read goes through this so the response shape
// stays consistent and the PublicUserDto contract is honored.
//
// `_count.comments` filters to top-level + ACTIVE: the relation count bypasses
// the soft-delete extension (it hooks top-level reads only), and we don't
// want replies inflating the per-post total — the design counts top-level
// threads, not total messages.
const POST_SELECT = {
  id: true,
  content: true,
  imageKey: true,
  visibility: true,
  authorId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  author: { select: PUBLIC_USER_SELECT },
  _count: {
    select: {
      comments: { where: { parentId: null, status: 'ACTIVE' } },
    },
  },
} satisfies Prisma.PostSelect;

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly imageProcessor: ImageProcessor,
    private readonly likes: LikesService,
  ) {}

  async create(
    authorId: string,
    dto: CreatePostDto,
    file?: UploadedImage,
  ): Promise<PostDto> {
    const imageKey = file ? await this.processAndStoreImage(file) : null;

    const post = await this.prisma.db.post.create({
      data: {
        authorId,
        content: dto.content,
        visibility: dto.visibility,
        imageKey,
      },
      select: POST_SELECT,
    });

    // Brand-new post — likeCount and hasLiked are known to be 0 / false; no
    // need to ask the likes service. Saves two queries per create.
    return this.toPostDto(post);
  }

  // Lightweight visibility check for other modules (comments, likes) that need
  // "does this post exist and can this viewer see it?" without paying for the
  // full PostDto SELECT + author join. Throws 404 for both missing and
  // private-non-author — same no-enumeration semantics as findOne, just
  // cheaper at scale.
  async assertVisible(id: string, viewerId: string): Promise<void> {
    const post = await this.prisma.db.post.findUnique({
      where: { id },
      select: { authorId: true, visibility: true },
    });

    if (!post) throw new NotFoundException('Post not found');
    if (post.visibility === 'PRIVATE' && post.authorId !== viewerId) {
      throw new NotFoundException('Post not found');
    }
  }

  // The visibility rule lives here, not in the controller, so every read path
  // applies it consistently (single endpoint today, embeds in other modules
  // tomorrow).
  async findOne(id: string, viewerId: string): Promise<PostDto> {
    const post = await this.prisma.db.post.findUnique({
      where: { id },
      select: POST_SELECT,
    });

    if (!post) throw new NotFoundException('Post not found');

    // Private posts: visible only to the author. We return 404 (not 403) so
    // existence doesn't leak — a snooping user can't enumerate private posts
    // by id.
    if (post.visibility === 'PRIVATE' && post.authorId !== viewerId) {
      throw new NotFoundException('Post not found');
    }

    // Four queries in parallel — like state is per-target, no batching
    // benefit for a single resource read. The top-likers + preview-comment
    // queries reuse the batched helpers with an array of one (window
    // function runs cleanly on a single id).
    const [likeCount, hasLiked, topLikersMap, previewMap] = await Promise.all([
      this.likes.countByTarget('POST', id),
      this.likes.hasUserLiked(viewerId, 'POST', id),
      this.likes.getTopLikersForTargets('POST', [id], 3),
      this.getPreviewCommentsForPosts([id], viewerId),
    ]);

    return this.toPostDto(post, {
      likeCount,
      hasLiked,
      topLikers: topLikersMap.get(id) ?? [],
      previewComment: previewMap.get(id) ?? null,
    });
  }

  async listFeed(viewerId: string, query: FeedQueryDto): Promise<FeedDto> {
    const { cursor, limit } = query;

    // Build the OR up front so the index `(visibility, status, createdAt)` is
    // the planner's first choice for the public slice; the author predicate
    // hits the `(authorId, status, createdAt)` index for the private slice.
    // Postgres combines them via BitmapOr.
    const where: Prisma.PostWhereInput = {
      OR: [{ visibility: 'PUBLIC' }, { authorId: viewerId }],
    };

    // Fetch one extra row to know whether `hasMore` is true.
    const rows = await this.prisma.db.post.findMany({
      where,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      select: POST_SELECT,
    });

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, -1) : rows;

    // N+1 protection: batch every per-post lookup in parallel. 4 extra
    // queries total for the page regardless of page size — not 4N. The
    // top-likers + preview-comment queries each use a single window-function
    // pass so a 50-post page still only fires one row per query.
    const postIds = sliced.map((p) => p.id);
    const [likeCounts, likedIds, topLikersMap, previewMap] = await Promise.all([
      this.likes.getLikeCountsForTargets('POST', postIds),
      this.likes.getLikedTargetIdsForUser(viewerId, 'POST', postIds),
      this.likes.getTopLikersForTargets('POST', postIds, 3),
      this.getPreviewCommentsForPosts(postIds, viewerId),
    ]);

    const items = sliced.map((p) =>
      this.toPostDto(p, {
        likeCount: likeCounts.get(p.id) ?? 0,
        hasLiked: likedIds.has(p.id),
        topLikers: topLikersMap.get(p.id) ?? [],
        previewComment: previewMap.get(p.id) ?? null,
      }),
    );

    // { data, meta } shape is recognized by ResponseInterceptor and surfaced
    // at the top level of the envelope alongside success+timestamp.
    return {
      data: items,
      meta: {
        hasMore,
        nextCursor: hasMore ? items[items.length - 1].id : null,
        limit,
      },
    };
  }

  async softDelete(id: string, requesterId: string): Promise<PostDto> {
    const post = await this.prisma.db.post.findUnique({
      where: { id },
      select: { id: true, authorId: true, imageKey: true },
    });

    if (!post) throw new NotFoundException('Post not found');
    if (post.authorId !== requesterId) {
      throw new ForbiddenException('You can only delete your own posts');
    }

    // Best-effort image cleanup — if the file is already gone, we don't care.
    // Logged because a recurring failure here is a sign the storage backend is
    // misbehaving.
    if (post.imageKey) {
      this.storage.delete(post.imageKey).catch((error) => {
        this.logger.warn(
          `Failed to delete image ${post.imageKey} for post ${post.id}: ${
            (error as Error).message
          }`,
        );
      });
    }

    const updated = await this.prisma.db.post.update({
      where: { id },
      data: { status: 'DELETED' },
      select: POST_SELECT,
    });

    // Return final state including like state — the deletion doesn't remove
    // the likes row (FK is on userId, not on a polymorphic targetId).
    const [likeCount, hasLiked, topLikersMap, previewMap] = await Promise.all([
      this.likes.countByTarget('POST', id),
      this.likes.hasUserLiked(requesterId, 'POST', id),
      this.likes.getTopLikersForTargets('POST', [id], 3),
      this.getPreviewCommentsForPosts([id], requesterId),
    ]);

    return this.toPostDto(updated, {
      likeCount,
      hasLiked,
      topLikers: topLikersMap.get(id) ?? [],
      previewComment: previewMap.get(id) ?? null,
    });
  }

  // ---------- internals ----------

  private async processAndStoreImage(file: UploadedImage): Promise<string> {
    const processed = await this.imageProcessor.forPost(file.buffer);
    return this.storage.save(processed, { prefix: 'posts', ext: 'webp' });
  }

  // Single round-trip that fetches the most-recent top-level comment per post
  // PLUS that comment's likeCount / hasLiked / replyCount, batched across the
  // whole feed page. Lives here (not in CommentsService) because PostsService
  // is already the consumer and CommentsService → PostsService is an existing
  // edge — adding the reverse would create a Nest module cycle.
  //
  // Query plan: ROW_NUMBER() PARTITION BY post_id ORDER BY created_at DESC
  // picks one comment per post; the lateral subqueries inline a count of
  // comment likes and a 0/1 flag for the viewer's like on that comment, so
  // the JSON returns a fully-populated CommentDto. Reply counts are filled
  // by a separate grouped query (cheaper than another lateral).
  private async getPreviewCommentsForPosts(
    postIds: string[],
    viewerId: string,
    limit = 1,
  ): Promise<Map<string, CommentSnapshot>> {
    if (postIds.length === 0) return new Map();

    const rows = await this.prisma.db.$queryRaw<PreviewCommentRow[]>`
      SELECT
        ranked.post_id AS "postId",
        ranked.id,
        ranked.parent_id AS "parentId",
        ranked.content,
        ranked.created_at AS "createdAt",
        ranked.updated_at AS "updatedAt",
        json_build_object(
          'id',         u.id,
          'firstName',  u.first_name,
          'lastName',   u.last_name,
          'avatarKey',  u.avatar_key
        ) AS author
      FROM (
        SELECT
          c.id,
          c.post_id,
          c.parent_id,
          c.content,
          c.author_id,
          c.created_at,
          c.updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY c.post_id
            ORDER BY c.created_at DESC
          ) AS rn
        FROM comments c
        WHERE c.post_id IN (${Prisma.join(postIds)})
          AND c.parent_id IS NULL
          AND c.status = 'ACTIVE'::"CommentStatus"
      ) ranked
      JOIN users u ON u.id = ranked.author_id
      WHERE ranked.rn <= ${limit}
    `;

    if (rows.length === 0) return new Map();

    const commentIds = rows.map((r) => r.id);
    // Batched: like state + reply count for the preview comments only.
    const [likeCounts, likedIds, replyCounts] = await Promise.all([
      this.likes.getLikeCountsForTargets('COMMENT', commentIds),
      this.likes.getLikedTargetIdsForUser(viewerId, 'COMMENT', commentIds),
      this.getReplyCountsForComments(commentIds),
    ]);

    return new Map(
      rows.map((r) => [
        r.postId,
        {
          id: r.id,
          postId: r.postId,
          parentId: r.parentId,
          content: r.content,
          author: r.author,
          replyCount: replyCounts.get(r.id) ?? 0,
          likeCount: likeCounts.get(r.id) ?? 0,
          hasLiked: likedIds.has(r.id),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        },
      ]),
    );
  }

  // Batched reply count by parent comment id. Single GROUP BY query → O(1)
  // lookup at the call site. Filters to ACTIVE to mirror the soft-delete
  // semantics the relation `_count` filter applies elsewhere.
  private async getReplyCountsForComments(
    commentIds: string[],
  ): Promise<Map<string, number>> {
    if (commentIds.length === 0) return new Map();

    const rows = await this.prisma.db.comment.groupBy({
      by: ['parentId'],
      where: { parentId: { in: commentIds }, status: 'ACTIVE' },
      _count: { _all: true },
    });

    return new Map(
      rows
        .filter(
          (r): r is typeof r & { parentId: string } => r.parentId !== null,
        )
        .map((r) => [r.parentId, r._count._all]),
    );
  }

  private toPostDto(
    post: Prisma.PostGetPayload<{ select: typeof POST_SELECT }>,
    likeState: LikeState = {
      likeCount: 0,
      hasLiked: false,
      topLikers: [],
      previewComment: null,
    },
  ): PostDto {
    return {
      id: post.id,
      content: post.content,
      imageKey: post.imageKey,
      imageUrl: this.storage.url(post.imageKey),
      visibility: post.visibility,
      author: post.author,
      likeCount: likeState.likeCount,
      hasLiked: likeState.hasLiked,
      topLikers: likeState.topLikers,
      commentCount: post._count.comments,
      previewComment: likeState.previewComment,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  }
}
