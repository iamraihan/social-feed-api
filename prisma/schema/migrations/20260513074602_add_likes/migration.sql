-- CreateEnum
CREATE TYPE "LikeTargetType" AS ENUM ('POST', 'COMMENT', 'REPLY');

-- CreateTable
CREATE TABLE "likes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "target_type" "LikeTargetType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "likes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "likes_target_type_target_id_created_at_idx" ON "likes"("target_type", "target_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "likes_user_id_target_type_created_at_idx" ON "likes"("user_id", "target_type", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "likes_user_id_target_type_target_id_key" ON "likes"("user_id", "target_type", "target_id");

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
