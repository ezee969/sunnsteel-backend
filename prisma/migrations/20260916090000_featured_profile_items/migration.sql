-- CreateEnum
CREATE TYPE "FeaturedProfileItemKind" AS ENUM ('RECORD', 'ACHIEVEMENT', 'RANK');

-- CreateTable
CREATE TABLE "FeaturedProfileItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "FeaturedProfileItemKind" NOT NULL,
    "referenceId" VARCHAR(100) NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeaturedProfileItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FeaturedProfileItem_position_check" CHECK ("position" >= 0 AND "position" < 6)
);

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedProfileItem_userId_position_key"
ON "FeaturedProfileItem"("userId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedProfileItem_userId_kind_referenceId_key"
ON "FeaturedProfileItem"("userId", "kind", "referenceId");

-- AddForeignKey
ALTER TABLE "FeaturedProfileItem"
ADD CONSTRAINT "FeaturedProfileItem_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
