CREATE TYPE "ProfileVisibility" AS ENUM ('PUBLIC', 'FOLLOWERS', 'PRIVATE');

ALTER TABLE "User"
ADD COLUMN "historyVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN "recordsVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN "routinesVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN "achievementsVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN "bodyMetricsVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PRIVATE';
