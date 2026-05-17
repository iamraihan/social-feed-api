# Social Feed API

Backend for the **Appifylab Full Stack Engineer selection task** — a social feed where users sign up, post text + image, like/unlike, comment with one level of replies, and toggle visibility between public and private.

Built with NestJS 11, Prisma 7, PostgreSQL 16, and Redis. The whole stack runs from a single `docker compose up` plus one migrate command. Designed against the brief's "millions of posts and reads" line: cursor pagination everywhere, composite indexes hit by every query, batched lookups so feed responses stay flat at any page size.

The task spec lives in `Assets/Selection Task for Full Stack Engineer at Appifylab/Selection Task for Full Stack Engineer at Appifylab.pdf` (sibling to this repo).

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node 20+, TypeScript 5.7 |
| Framework | NestJS 11 |
| ORM / DB | Prisma 7 / PostgreSQL 16 |
| Cache / blocklist | Redis (ioredis) |
| Auth | JWT (HS256) + refresh-token rotation with family-based reuse detection |
| Image processing | sharp (resize, EXIF strip, WebP) |
| Image storage | Cloudinary (CDN-delivered) |
| Validation | class-validator + class-transformer |
| Rate limiting | `@nestjs/throttler` |
| Scheduling | `@nestjs/schedule` (nightly token cleanup) |
| Package manager | pnpm 10 |

---

## Quick start

```bash
# 1. Install deps
pnpm install

# 2. Copy env template
cp .env.example .env
# (defaults work out of the box for local dev — except Cloudinary; see below)

# 2a. Fill in Cloudinary credentials in .env (see "Cloudinary setup" section)

# 3. Bring up Postgres, Redis, pgAdmin
docker compose up -d

# 4. Run migrations (creates users, posts, comments, refresh_tokens, likes tables)
pnpm db:migrate

# 5. Start the API in watch mode
pnpm start:dev
```

The API will listen on `http://localhost:8000`. (Port 8000 leaves `:3000` free for the Next.js frontend so both apps can run side by side without a clash.)

Postgres is on `5434` (host) to avoid clashing with a default Postgres install. pgAdmin is on `http://localhost:5050` (login `admin@social-feed.local` / `admin`).

### Useful scripts

```bash
pnpm db:up         # docker compose up -d
pnpm db:down       # docker compose down
pnpm db:migrate    # prisma migrate dev
pnpm db:reset      # prisma migrate reset (wipes everything)
pnpm db:studio     # prisma studio
pnpm build         # nest build
pnpm lint          # eslint --fix
```

---

## Environment variables

See `.env.example` for the full list with comments. The validator at boot (`src/config/environment.validation.ts`) refuses to start the app on a misconfig — for example:

- `JWT_ACCESS_SECRET` must be at least 32 characters. Generate one with `openssl rand -hex 64`.
- `NODE_ENV=production` requires `COOKIE_SECURE=true` and a non-empty `CORS_ORIGIN` allow-list. Boots fail otherwise.
- Numeric env vars (ports, TTLs) have `@Min`/`@Max` bounds — `ACCESS_TOKEN_TTL_SECONDS=0` won't start the app.
- `DATABASE_URL` is validated as a real PostgreSQL URL.

This is the single highest-leverage safety check in the codebase. Misconfigured prod deploys die at boot, not at first request.

---

## Cloudinary setup

Image bytes live on Cloudinary; the DB stores only the `public_id`. Cloudinary's CDN delivers them, and `f_auto,q_auto` URL transforms serve AVIF/WebP per-client without us pre-encoding variants.

**Get credentials** (free tier is plenty for this app):

1. Sign up at [cloudinary.com](https://cloudinary.com) (free, no card).
2. From the **Dashboard**, copy **Cloud Name**, **API Key**, **API Secret**.
3. Paste into `.env`:

   ```env
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret
   CLOUDINARY_FOLDER=social-feed   # optional namespace inside the account
   ```

The env validator refuses to boot if `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` are missing.

**Switching back to local disk for offline dev:** set `STORAGE_DRIVER=local` in `.env`. The `StorageModule` factory picks the impl at boot — no code edit, no rebuild. Unknown values fail boot loudly rather than silently misroute uploads. Both impls share the same abstract `StorageService` DI token, so consumers (e.g. `PostsService`) don't care which is active.

> **Migration note:** existing DB rows with local keys like `posts/<uuid>.webp` will not resolve against Cloudinary. Wipe `posts.image_key` on switchover, or run a script that re-uploads the local files and rewrites the keys.

---

## What's built

Module-by-module breakdown of the API surface:

### Auth (`/auth/*`)
- `POST /auth/register` — creates a user and logs them in (returns access token + sets refresh cookie)
- `POST /auth/login` — credential check, constant-time bcrypt against a dummy hash to prevent email enumeration
- `POST /auth/refresh` — rotates the refresh token, detects reuse and revokes the whole family if a stolen token is replayed
- `POST /auth/logout` — revokes the current refresh-token family
- `POST /auth/logout-all` — revokes all the user's refresh-token families, blocklists their access tokens in Redis until their natural expiry

### Users (`/users/*`)
- `GET /users/me` — full self profile (includes email)
- `PATCH /users/me` — update firstName, lastName, avatarKey
- `DELETE /users/me` — soft-delete own account
- `GET /users/:id` — public profile of another user (no email leakage; returns `PublicUserDto`)

### Posts (`/posts/*`)
- `POST /posts` — create with `content` + optional `image` (multipart form). Sharp processes the image: auto-rotate via EXIF, strip EXIF/metadata, resize to 1080px max, convert to WebP, reject pixel bombs over 50M pixels.
- `GET /posts` — feed (newest first, cursor paginated). Returns public posts plus the viewer's own private posts.
- `GET /posts/:id` — single post; 404s for private posts the viewer doesn't own (no existence enumeration).
- `DELETE /posts/:id` — soft-delete own post; orphan image cleaned up.

### Comments (`/posts/:postId/comments`, `/comments/*`)
- `POST /posts/:postId/comments` — create top-level comment on a post
- `POST /comments/:commentId/replies` — reply to a top-level comment
- `GET /posts/:postId/comments` — paginated, newest-first
- `GET /comments/:commentId/replies` — paginated
- `DELETE /comments/:id` — soft-delete own (works for top-level and replies)

Comments and replies share a single table via self-referencing `parent_id`. The service enforces one level of nesting only — replies to replies return 400.

### Likes (`/likes/:type/:id`)
- `POST /likes/:type/:id` — like a post / comment / reply (idempotent)
- `DELETE /likes/:type/:id` — unlike (idempotent, no-op if not liked)
- `GET /likes/:type/:id/users` — paginated list of users who liked

Likes are polymorphic — one table covers all three target kinds. The type in the URL must match the target's actual shape (a reply liked via `/likes/comment/:id` is rejected, preventing double-likes via the unique-constraint loophole).

Each post and comment response includes `likeCount: number` and `hasLiked: boolean`. List endpoints batch these so the cost is two extra queries per page regardless of page size — no N+1.

---

## Architecture & decisions

### Auth pattern — JWT + opaque refresh tokens with family rotation
Access tokens are short-lived JWTs (15 min) signed with HS256 and a `jti` claim. Refresh tokens are 40 random bytes (not JWTs), stored as `sha256(token)` in the DB, sent only via httpOnly + `sameSite=strict` cookies scoped to `/auth`. Every refresh rotates the token and inherits the same `family_id`. A token marked `used = true` showing up again means the original was stolen and replayed — the whole family is revoked and the user is forced to re-authenticate.

Two-tier guards:
- `JwtAuthGuard` (light) — verifies JWT signature + expiry only. Used on reads.
- `JwtStrictAuthGuard` (strict) — adds a Redis blocklist check on `jti` and `userId`. Used on destructive operations.

Trade-off: light-guarded routes tolerate a ~15min staleness window after a mass-revocation event, in exchange for no Redis hit on the feed-scroll hot path.

### Response envelope
Every response, success or error, has the same outer shape:

```json
// Single resource
{ "success": true, "timestamp": "...", "data": { ... } }

// Paginated
{ "success": true, "timestamp": "...", "data": [...], "meta": { "hasMore": true, "nextCursor": "...", "limit": 20 } }

// Error (any 4xx / 5xx)
{ "success": false, "timestamp": "...", "error": { "code": "VALIDATION_FAILED", "message": "...", "details": [...] } }
```

Error codes are semantic strings (`CONFLICT`, `NOT_FOUND`, `VALIDATION_FAILED`, ...) — clients branch on the code rather than HTTP status numbers. Prisma codes (`P2002`, `P2025`, ...) are mapped at the filter layer; they never leak to the client.

### Image upload — Cloudinary + sharp
Multer with `memoryStorage`, sharp pipeline (`.rotate().resize().webp()`), then `CloudinaryStorageService.save()` streams the buffer to Cloudinary via `upload_stream`. The DB stores the returned `public_id` (e.g. `social-feed/posts/<uuid>`). Delivery URLs are built with `cloudinary.url(key, { secure, fetch_format: 'auto', quality: 'auto' })` so the CDN serves AVIF/WebP per-client without us pre-encoding variants.

Why pre-process with sharp *and* hand off to Cloudinary: the sharp pass strips EXIF (GPS/device leak) and rejects pixel bombs (>50M pixels) **before** any bytes leave our process. It also gates Cloudinary bandwidth — we upload 1080px WebP@85, not the user's raw 12MB phone photo.

`StorageService` is an abstract class — `LocalStorageService` (disk) and `CloudinaryStorageService` are interchangeable via the `useClass` in `StorageModule`. Swapping to S3 / MinIO is a third one-class addition.

Image URLs deliberately aren't auth-checked. Post visibility hides the post body, but the image URL (random-UUID `public_id`) is treated as public-by-obscurity — same as Twitter / Instagram / Facebook. If stricter image privacy were required, Cloudinary's signed-delivery URLs with TTL are the right move; the URL builder already runs through a single chokepoint (`StorageService.url`) so the change is one method.

### Polymorphic likes — no FK on the target
Likes can attach to posts, comments, or replies. Rather than three tables, one `likes` table with `target_type` + `target_id` covers all three. No DB-level FK on `target_id` (the type discriminator decides which parent table it points to) — existence is verified at the service layer before every write.

The unique index `(user_id, target_type, target_id)` is the trip-wire that makes likes idempotent. P2002 → return the existing row.

### Soft delete via Prisma client extension
Users, posts, and comments share a `status` column with a `DELETED` value. A Prisma extension (`src/prisma/prisma.extension.ts`) auto-injects `status: { not: 'DELETED' }` on every `findX` / `count` call. Services that delete just set the status — no rows are physically removed, and no consumer code needs to remember to filter.

### N+1 protection on feed reads
The classic trap: render 20 posts, then loop fetching like state per post = 40 queries. The likes service exposes two **batched** methods:
- `getLikeCountsForTargets(type, ids[])` — single `GROUP BY` query, returns `Map<id, count>`
- `getLikedTargetIdsForUser(userId, type, ids[])` — single `findMany`, returns `Set<id>`

Feed endpoints invoke both in parallel after the main `findMany`, so the total is **3 queries per feed page**, regardless of page size. The batched signatures make N+1 structurally impossible at the call site.

### Cursor pagination
Every list endpoint uses `cursor: { id: <last_id> }` + `take: limit + 1`. The `+1` tells us `hasMore` without a separate count. Stays fast at depth — offset pagination would scan-and-skip past growing chunks.

### Production-grade boot safety
The env validator (`validateEnvironment`) refuses to boot when:
- `JWT_ACCESS_SECRET` is shorter than 32 characters
- `NODE_ENV=production` but `COOKIE_SECURE` isn't `true`
- `NODE_ENV=production` but `CORS_ORIGIN` isn't set
- Any port is outside 1–65535
- `DATABASE_URL` isn't a valid Postgres URL

A misconfigured production deploy dies at startup with a clear error — not at the first request.

---

## Project structure

```
src/
├── app.module.ts                  # root module composition + global throttler
├── main.ts                        # bootstrap: helmet, CORS, cookie-parser, static files, filters
├── common/
│   ├── interceptors/              # ResponseInterceptor (success envelope)
│   ├── filters/                   # HttpExceptionFilter, PrismaExceptionFilter
│   └── types/                     # ApiSuccessResponse, ApiErrorResponse, Paginated<T>
├── config/                        # database, auth, redis, storage, env validation
├── prisma/
│   ├── prisma.module.ts
│   ├── prisma.service.ts          # driver-adapter setup + extension
│   └── prisma.extension.ts        # soft-delete auto-filter
├── redis/                         # ioredis provider for blocklist
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── decorators/                # @CurrentUser
│   ├── guards/                    # JwtAuthGuard, JwtStrictAuthGuard
│   ├── services/                  # auth, refresh-token, token-blocklist
│   ├── strategies/                # passport-jwt (light + strict)
│   ├── tasks/                     # nightly refresh-token cleanup cron
│   ├── utils/                     # crypto helpers (token gen + sha256)
│   └── dto/
├── users/                         # service + controller + DTOs + select shapes
├── posts/                         # service + controller + DTOs
├── comments/                      # service + controller + DTOs (parent_id self-FK)
├── likes/                         # polymorphic likes + batched read methods
└── storage/
    ├── storage.module.ts             # @Global; chooses the active impl
    ├── storage.service.ts            # abstract class (DI token; S3 swap point)
    ├── cloudinary-storage.service.ts # active impl — Cloudinary CDN
    ├── local-storage.service.ts      # fallback impl — disk (offline dev)
    └── image-processor.service.ts    # sharp presets (forPost, future forAvatar)

prisma/schema/
├── schema.prisma                  # generator + datasource
├── user.prisma                    # User + UserStatus
├── refresh-token.prisma           # auth refresh tokens (sha256 hashed)
├── post.prisma                    # Post + PostVisibility + PostStatus
├── comment.prisma                 # Comment (self-FK for replies) + CommentStatus
├── like.prisma                    # Like + LikeTargetType (polymorphic)
└── migrations/                    # six migrations, each per branch
```

---

## Deployment (Render)

A `render.yaml` blueprint at the repo root provisions Postgres, Redis, and the API in one apply. The blueprint also wires the three together — `DATABASE_URL`, `POSTGRES_*`, and `REDIS_*` are injected automatically from the managed services; you don't paste connection strings by hand.

```bash
# 1. Push the branch to GitHub
git push origin main

# 2. In the Render dashboard: New → Blueprint → connect this repo
#    Render reads render.yaml and creates all three services.

# 3. Open the social-feed-api service → Environment → set the secrets that
#    render.yaml marked `sync: false`:
#      - CORS_ORIGIN              (your frontend origin, e.g. https://app.example.com)
#      - CLOUDINARY_CLOUD_NAME
#      - CLOUDINARY_API_KEY
#      - CLOUDINARY_API_SECRET
#    (JWT_ACCESS_SECRET is generated automatically — leave alone.)

# 4. Trigger a manual deploy from the dashboard (or push another commit).
#    Build command runs:
#      pnpm install --frozen-lockfile
#      pnpm exec prisma generate
#      pnpm build
#      pnpm exec prisma migrate deploy
```

### Why pnpm works out of the box

`pnpm-lock.yaml` is committed and `engines.pnpm` is declared in `package.json` — Render's Node runtime detects pnpm without any extra buildpack config.

### Free-tier gotchas

| Service | Quirk |
|---|---|
| Web | Sleeps after 15min idle. First request after sleep = ~30s cold start. |
| Postgres | Free instance is **deleted after 90 days**. Upgrade to a paid plan before that window if you need persistence. |
| Redis | 25MB cap. Fine for the access-token blocklist — entries are tiny and TTL'd. |

### Migrations on each deploy

`prisma migrate deploy` runs at the end of every build. Safe by design: it applies pending migrations only, never drops data, and is the supported production command (unlike `migrate dev` which can reset the schema).

---

## What's intentionally out of scope

The provided HTML design shows features the PDF brief explicitly defers ("you may ignore most of the design elements — focus only on the main functionality of the feed"). The following weren't built:

- Friend requests, find friends, suggested people, "connect" buttons
- Notifications panel
- Search bar
- Stories
- Save / hide / report / share post
- Edit post / edit comment (only create + delete)
- Email verification, forgot password
- Multi-level reply threading (one level enforced in service)
- Admin / moderator role tier (no roles in the spec)

The following are real production concerns but were deferred against the scope:

- Tests (the spec doesn't require them; broken scaffold tests would signal worse than no tests)
- Swagger / OpenAPI docs
- Request-ID correlation middleware (would slot into the error envelope's `meta`)
- Structured JSON logs (currently the Nest default Logger)
- Per-user throttle keys instead of per-IP
- Throttler Redis-backed storage for multi-instance scale (currently in-memory)
- S3 / MinIO as an alternative to Cloudinary (one-class addition via the `StorageService` abstraction)

Each of these has a clear next step in the codebase if/when needed — most are one-class or one-config changes thanks to the abstractions in place.

---

## Migration history

Six migrations, each one per feature branch:

```
init_users           — User + UserStatus (retroactively added during auth branch)
add_refresh_tokens   — RefreshToken + indices + FK to users
add_posts            — Post + visibility + status + author/visibility indices
add_comments         — Comment + self-FK + composite indices
add_likes            — Like + LikeTargetType + 3 indices including UNIQUE
```

Each migration matches the PR that introduced its schema change. Running `pnpm db:migrate` on a fresh DB replays all five in order.

---

## Author

Raihan Ali — `raihanali.dev@gmail.com`
