-- CreateTable
CREATE TABLE "TrainingLocationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "barWeightKg" DOUBLE PRECISION NOT NULL,
    "availablePlatePairs" JSONB NOT NULL DEFAULT '[]',
    "equipment" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingLocationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingLocationPreference_userId_name_key"
ON "TrainingLocationPreference"("userId", "name");

-- CreateIndex
CREATE INDEX "TrainingLocationPreference_userId_isDefault_idx"
ON "TrainingLocationPreference"("userId", "isDefault");

-- AddForeignKey
ALTER TABLE "TrainingLocationPreference"
ADD CONSTRAINT "TrainingLocationPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
