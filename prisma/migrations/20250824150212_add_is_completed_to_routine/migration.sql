/*
  Warnings:

  - You are about to drop the `WorkoutExercise` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WorkoutSession` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WorkoutSet` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "WorkoutExercise" DROP CONSTRAINT "WorkoutExercise_exerciseId_fkey";

-- DropForeignKey
ALTER TABLE "WorkoutExercise" DROP CONSTRAINT "WorkoutExercise_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "WorkoutSession" DROP CONSTRAINT "WorkoutSession_routineDayId_fkey";

-- DropForeignKey
ALTER TABLE "WorkoutSession" DROP CONSTRAINT "WorkoutSession_routineId_fkey";

-- DropForeignKey
ALTER TABLE "WorkoutSession" DROP CONSTRAINT "WorkoutSession_userId_fkey";

-- DropForeignKey
ALTER TABLE "WorkoutSet" DROP CONSTRAINT "WorkoutSet_sessionExerciseId_fkey";

-- DropTable
DROP TABLE "WorkoutExercise";

-- DropTable
DROP TABLE "WorkoutSession";

-- DropTable
DROP TABLE "WorkoutSet";

-- DropEnum
DROP TYPE "WorkoutSessionStatus";
