-- SOC-08: an explicit mutual training-partner relationship with independent
-- grants from each member. A block deletes the partnership in the same
-- transaction, and the grants cascade with it, so access disappears at once.

CREATE TYPE "TrainingPartnershipStatus" AS ENUM ('PENDING', 'ACTIVE');

CREATE TABLE "TrainingPartnership" (
    "id" TEXT NOT NULL,
    "pairKey" VARCHAR(73) NOT NULL,
    "requesterId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "status" "TrainingPartnershipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "TrainingPartnership_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TrainingPartnership_distinct_members_check" CHECK ("requesterId" <> "recipientId")
);

CREATE TABLE "TrainingPartnerGrant" (
    "partnershipId" TEXT NOT NULL,
    "grantorId" TEXT NOT NULL,
    "schedule" BOOLEAN NOT NULL DEFAULT false,
    "progress" BOOLEAN NOT NULL DEFAULT false,
    "activity" BOOLEAN NOT NULL DEFAULT false,
    "routines" BOOLEAN NOT NULL DEFAULT false,
    "encouragement" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingPartnerGrant_pkey" PRIMARY KEY ("partnershipId", "grantorId")
);

CREATE UNIQUE INDEX "TrainingPartnership_pairKey_key" ON "TrainingPartnership"("pairKey");
CREATE INDEX "TrainingPartnership_requesterId_status_createdAt_idx" ON "TrainingPartnership"("requesterId", "status", "createdAt");
CREATE INDEX "TrainingPartnership_recipientId_status_createdAt_idx" ON "TrainingPartnership"("recipientId", "status", "createdAt");
CREATE INDEX "TrainingPartnerGrant_grantorId_idx" ON "TrainingPartnerGrant"("grantorId");

ALTER TABLE "TrainingPartnership" ADD CONSTRAINT "TrainingPartnership_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingPartnership" ADD CONSTRAINT "TrainingPartnership_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingPartnerGrant" ADD CONSTRAINT "TrainingPartnerGrant_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "TrainingPartnership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingPartnerGrant" ADD CONSTRAINT "TrainingPartnerGrant_grantorId_fkey" FOREIGN KEY ("grantorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
