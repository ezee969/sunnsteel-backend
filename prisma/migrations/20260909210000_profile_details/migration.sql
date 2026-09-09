ALTER TABLE "User"
ADD COLUMN "bio" VARCHAR(500),
ADD COLUMN "location" VARCHAR(100),
ADD COLUMN "bioVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN "locationVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PRIVATE';
