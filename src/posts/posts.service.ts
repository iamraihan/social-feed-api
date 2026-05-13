import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LikesService } from '../likes/likes.service';
import { ImageProcessor } from '../storage/image-processor.service';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_USER_SELECT } from '../users/users.service';
import { CreatePostDto, FeedDto, FeedQueryDto, PostDto } from './dto';

// Framework-agnostic upload shape. The controller maps Express.Multer.File to
// this; the service never imports Express or Multer types. Makes the service
// testable without HTTP fixtures and survives swapping the transport layer.
export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
}

// Per-row like state attached to a PostDto. Defaulted to 0 / false at the
// mapper so callers can omit it for paths where likes are irrelevant
// (newly-created posts, etc.).
interface LikeState {
  likeCount: number;
  hasLiked: boolean;
}

// Shared selection shape: every read goes through this so the response shape
// stays consistent and the PublicUserDto contract is honored.
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

    // Two queries in parallel — like state is per-target, no batching benefit
    // for a single resource read.
    const [likeCount, hasLiked] = await Promise.all([
      this.likes.countByTarget('POST', id),
      this.likes.hasUserLiked(viewerId, 'POST', id),
    ]);

    return this.toPostDto(post, { likeCount, hasLiked });
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

    // N+1 protection: batch both like-related lookups in parallel. Result is
    // 2 extra queries total for the page, regardless of page size — not 2N.
    const postIds = sliced.map((p) => p.id);
    const [likeCounts, likedIds] = await Promise.all([
      this.likes.getLikeCountsForTargets('POST', postIds),
      this.likes.getLikedTargetIdsForUser(viewerId, 'POST', postIds),
    ]);

    const items = sliced.map((p) =>
      this.toPostDto(p, {
        likeCount: likeCounts.get(p.id) ?? 0,
        hasLiked: likedIds.has(p.id),
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
    const [likeCount, hasLiked] = await Promise.all([
      this.likes.countByTarget('POST', id),
      this.likes.hasUserLiked(requesterId, 'POST', id),
    ]);

    return this.toPostDto(updated, { likeCount, hasLiked });
  }

  // ---------- internals ----------

  private async processAndStoreImage(file: UploadedImage): Promise<string> {
    const processed = await this.imageProcessor.forPost(file.buffer);
    return this.storage.save(processed, { prefix: 'posts', ext: 'webp' });
  }

  private toPostDto(
    post: Prisma.PostGetPayload<{ select: typeof POST_SELECT }>,
    likeState: LikeState = { likeCount: 0, hasLiked: false },
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
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  }
}
