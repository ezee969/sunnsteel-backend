-- CreateEnum
CREATE TYPE "TrainingGoal" AS ENUM ('STRENGTH', 'MUSCLE_GROWTH', 'FAT_LOSS', 'ENDURANCE', 'GENERAL_FITNESS', 'ATHLETIC_PERFORMANCE', 'MOBILITY');

-- CreateEnum
CREATE TYPE "TrainingExperienceLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "TrainingDiscipline" AS ENUM ('BODYBUILDING', 'POWERLIFTING', 'WEIGHTLIFTING', 'CALISTHENICS', 'STRONGMAN', 'HYBRID_TRAINING', 'GENERAL_STRENGTH');

-- CreateEnum
CREATE TYPE "PreferredTrainingStyle" AS ENUM ('FULL_BODY', 'UPPER_LOWER', 'PUSH_PULL_LEGS', 'BODY_PART_SPLIT', 'CIRCUIT');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "trainingGoals" "TrainingGoal"[] NOT NULL DEFAULT ARRAY[]::"TrainingGoal"[],
ADD COLUMN "trainingExperienceLevel" "TrainingExperienceLevel",
ADD COLUMN "trainingDisciplines" "TrainingDiscipline"[] NOT NULL DEFAULT ARRAY[]::"TrainingDiscipline"[],
ADD COLUMN "preferredTrainingStyle" "PreferredTrainingStyle",
ADD COLUMN "trainingIdentityVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PRIVATE';

-- CreateTable
CREATE TABLE "UserFavoriteExercise" (
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFavoriteExercise_pkey" PRIMARY KEY ("userId", "exerciseId")
);

-- CreateIndex
CREATE INDEX "UserFavoriteExercise_userId_position_idx" ON "UserFavoriteExercise"("userId", "position");

-- CreateIndex
CREATE INDEX "UserFavoriteExercise_exerciseId_idx" ON "UserFavoriteExercise"("exerciseId");

-- AddForeignKey
ALTER TABLE "UserFavoriteExercise" ADD CONSTRAINT "UserFavoriteExercise_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFavoriteExercise" ADD CONSTRAINT "UserFavoriteExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
