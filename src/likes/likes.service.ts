import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LikeTargetType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_USER_SELECT } from '../users/users.service';
import { PublicUserDto } from '../users/dto';
import { LikersListDto, ListLikersQueryDto } from './dto';

// Shape the raw `json_agg` returns from getTopLikersForTargets. Same fields
// as PublicUserDto — alias kept so service callers don't have to know the
// query layer produces JSON.
type PublicUserSnapshot = Pick<
  PublicUserDto,
  'id' | 'firstName' | 'lastName' | 'avatarKey'
>;
export type { PublicUserSnapshot };

@Injectable()
export class LikesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- writes ----------

  async like(
    userId: string,
    targetType: LikeTargetType,
    targetId: string,
  ): Promise<{ id: string; createdAt: Date }> {
    await this.assertTargetVisible(targetType, targetId, userId);

    try {
      return await this.prisma.db.like.create({
        data: { userId, targetType, targetId },
        select: { id: true, createdAt: true },
      });
    } catch (error) {
      // P2002 = unique violation → already liked → return existing row so the
      // endpoint stays idempotent (repeated taps don't 409 or change state).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.prisma.db.like.findUniqueOrThrow({
          where: {
            userId_targetType_targetId: { userId, targetType, targetId },
          },
          select: { id: true, createdAt: true },
        });
      }
      throw error;
    }
  }

  async unlike(
    userId: string,
    targetType: LikeTargetType,
    targetId: string,
  ): Promise<void> {
    try {
      await this.prisma.db.like.delete({
        where: {
          userId_targetType_targetId: { userId, targetType, targetId },
        },
      });
    } catch (error) {
      // P2025 = row not found → wasn't liked → no-op success. Idempotent and
      // avoids leaking "this thing exists or not" via 404 timing.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        return;
      }
      throw error;
    }
  }

  // ---------- batched reads (N+1 protection for feed/comment lists) ----------

  // Single GROUP BY query returning a Map<targetId, count> for O(1) lookup at
  // the call site. Used by feed/comment listings to surface likeCount on
  // every item in one DB roundtrip regardless of page size.
  async getLikeCountsForTargets(
    targetType: LikeTargetType,
    targetIds: string[],
  ): Promise<Map<string, number>> {
    if (targetIds.length === 0) return new Map();

    const rows = await this.prisma.db.like.groupBy({
      by: ['targetId'],
      where: { targetType, targetId: { in: targetIds } },
      _count: { _all: true },
    });

    return new Map(rows.map((r) => [r.targetId, r._count._all]));
  }

  // Single query returning a Map<targetId, PublicUser[]> with up to N most
  // recent likers per target. Replaces the previous per-post lazy fetch the
  // feed used to make (which was N+1 by call count). Built around a
  // ROW_NUMBER() window so Postgres reads exactly `limit * targetIds.length`
  // rows from the (target_type, target_id, created_at DESC) index, then
  // joins each to its user — a single round-trip regardless of page size.
  async getTopLikersForTargets(
    targetType: LikeTargetType,
    targetIds: string[],
    limit = 3,
  ): Promise<Map<string, PublicUserSnapshot[]>> {
    if (targetIds.length === 0) return new Map();

    type TopLikersRow = {
      targetId: string;
      users: PublicUserSnapshot[];
    };

    const rows = await this.prisma.db.$queryRaw<TopLikersRow[]>`
      SELECT
        ranked.target_id AS "targetId",
        json_agg(
          json_build_object(
            'id',         u.id,
            'firstName',  u.first_name,
            'lastName',   u.last_name,
            'avatarKey',  u.avatar_key
          )
          ORDER BY ranked.created_at DESC
        ) AS users
      FROM (
        SELECT
          l.target_id,
          l.user_id,
          l.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY l.target_id
            ORDER BY l.created_at DESC
          ) AS rn
        FROM likes l
        WHERE l.target_type = ${targetType}::"LikeTargetType"
          AND l.target_id IN (${Prisma.join(targetIds)})
      ) ranked
      JOIN users u ON u.id = ranked.user_id
      WHERE ranked.rn <= ${limit}
      GROUP BY ranked.target_id
    `;

    return new Map(rows.map((r) => [r.targetId, r.users]));
  }

  async getLikedTargetIdsForUser(
    userId: string,
    targetType: LikeTargetType,
    targetIds: string[],
  ): Promise<Set<string>> {
    if (targetIds.length === 0) return new Set();

    const rows = await this.prisma.db.like.findMany({
      where: { userId, targetType, targetId: { in: targetIds } },
      select: { targetId: true },
    });

    return new Set(rows.map((r) => r.targetId));
  }

  // ---------- single-target reads ----------

  async countByTarget(
    targetType: LikeTargetType,
    targetId: string,
  ): Promise<number> {
    return this.prisma.db.like.count({ where: { targetType, targetId } });
  }

  async hasUserLiked(
    userId: string,
    targetType: LikeTargetType,
    targetId: string,
  ): Promise<boolean> {
    const hit = await this.prisma.db.like.findUnique({
      where: {
        userId_targetType_targetId: { userId, targetType, targetId },
      },
      select: { id: true },
    });
    return hit !== null;
  }

  // ---------- list likers ----------

  async listLikers(
    targetType: LikeTargetType,
    targetId: string,
    viewerId: string,
    query: ListLikersQueryDto,
  ): Promise<LikersListDto> {
    await this.assertTargetVisible(targetType, targetId, viewerId);

    const { cursor, limit } = query;

    // Parallel: page of rows + total count. Both use the
    // (targetType, targetId, createdAt) composite index.
    const [rows, total] = await Promise.all([
      this.prisma.db.like.findMany({
        where: { targetType, targetId },
        cursor: cursor ? { id: cursor } : undefined,
        skip: cursor ? 1 : 0,
        take: limit + 1,
        orderBy: { createdAt: 'desc' },
        select: { id: true, user: { select: PUBLIC_USER_SELECT } },
      }),
      this.prisma.db.like.count({ where: { targetType, targetId } }),
    ]);

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, -1) : rows;

    return {
      data: sliced.map((r) => r.user),
      meta: {
        hasMore,
        nextCursor: hasMore ? sliced[sliced.length - 1].id : null,
        limit,
        total,
      },
    };
  }

  // ---------- internals ----------

  // Verifies the target exists AND is visible to the viewer. Direct Prisma
  // access (not via PostsService / CommentsService) — would otherwise create
  // a circular module dependency, since those services inject LikesService
  // to populate likeCount/hasLiked on their own responses.
  //
  // The visibility logic mirrors PostsService.assertVisible exactly; a small
  // DRY violation that pays for itself in clean module wiring.
  private async assertTargetVisible(
    targetType: LikeTargetType,
    targetId: string,
    viewerId: string,
  ): Promise<void> {
    switch (targetType) {
      case 'POST': {
        const post = await this.prisma.db.post.findUnique({
          where: { id: targetId },
          select: { authorId: true, visibility: true },
        });
        if (!post) throw new NotFoundException('Post not found');
        if (post.visibility === 'PRIVATE' && post.authorId !== viewerId) {
          throw new NotFoundException('Post not found');
        }
        return;
      }
      case 'COMMENT':
      case 'REPLY': {
        // Both COMMENT and REPLY live in the same `comments` table; the
        // discriminator is whether parent_id is null. We fetch parent_id in
        // the same query (free — already on the row) and enforce that the
        // URL's targetType matches the comment's actual shape.
        //
        // Why: the unique index is (userId, targetType, targetId). Without
        // this check, a user could like a top-level comment as REPLY (or vice
        // versa) and the constraint would allow it — same target id, different
        // type tuple. That's two like rows for the same comment, inflating
        // storage and skewing analytics. Cross-checking here closes that gap.
        const comment = await this.prisma.db.comment.findUnique({
          where: { id: targetId },
          select: {
            parentId: true,
            post: { select: { authorId: true, visibility: true } },
          },
        });
        if (!comment) throw new NotFoundException('Comment not found');

        const isReply = comment.parentId !== null;
        if (targetType === 'COMMENT' && isReply) {
          throw new BadRequestException(
            'This is a reply — use /likes/reply/:id instead',
          );
        }
        if (targetType === 'REPLY' && !isReply) {
          throw new BadRequestException(
            'This is a top-level comment — use /likes/comment/:id instead',
          );
        }

        if (
          comment.post.visibility === 'PRIVATE' &&
          comment.post.authorId !== viewerId
        ) {
          throw new NotFoundException('Comment not found');
        }
        return;
      }
    }
  }
}
