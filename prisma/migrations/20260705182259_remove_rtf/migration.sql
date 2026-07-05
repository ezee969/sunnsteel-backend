/*
  Warnings:

  - The values [PROGRAMMED_RTF,PROGRAMMED_RTF_HYPERTROPHY] on the enum `ProgressionScheme` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `programDurationWeeks` on the `Routine` table. All the data in the column will be lost.
  - You are about to drop the column `programEndDate` on the `Routine` table. All the data in the column will be lost.
  - You are about to drop the column `programRtfSnapshot` on the `Routine` table. All the data in the column will be lost.
  - You are about to drop the column `programStartDate` on the `Routine` table. All the data in the column will be lost.
  - You are about to drop the column `programStartWeek` on the `Routine` table. All the data in the column will be lost.
  - You are about to drop the column `programStyle` on the `Routine` table. All the data in the column will be lost.
  - You are about to drop the column `programTimezone` on the `Routine` table. All the data in the column will be lost.
  - You are about to drop the column `programTrainingDaysOfWeek` on the `Routine` table. All the data in the column will be lost.
  - You are about to drop the column `programWithDeloads` on the `Routine` table. All the data in the column will be lost.
  - You are about to drop the column `programLastAdjustedWeek` on the `RoutineExercise` table. All the data in the column will be lost.
  - You are about to drop the column `programRoundingKg` on the `RoutineExercise` table. All the data in the column will be lost.
  - You are about to drop the column `programStyle` on the `RoutineExercise` table. All the data in the column will be lost.
  - You are about to drop the column `programTMKg` on the `RoutineExercise` table. All the data in the column will be lost.
  - You are about to drop the `TmAdjustment` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ProgressionScheme_new" AS ENUM ('NONE', 'DOUBLE_PROGRESSION', 'DYNAMIC_DOUBLE_PROGRESSION');
ALTER TABLE "public"."RoutineExercise" ALTER COLUMN "progressionScheme" DROP DEFAULT;
ALTER TABLE "RoutineExercise" ALTER COLUMN "progressionScheme" TYPE "ProgressionScheme_new" USING ("progressionScheme"::text::"ProgressionScheme_new");
ALTER TYPE "ProgressionScheme" RENAME TO "ProgressionScheme_old";
ALTER TYPE "ProgressionScheme_new" RENAME TO "ProgressionScheme";
DROP TYPE "public"."ProgressionScheme_old";
ALTER TABLE "RoutineExercise" ALTER COLUMN "progressionScheme" SET DEFAULT 'NONE';
COMMIT;

-- DropForeignKey
ALTER TABLE "TmAdjustment" DROP CONSTRAINT "TmAdjustment_routineId_fkey";

-- AlterTable
ALTER TABLE "Routine" DROP COLUMN "programDurationWeeks",
DROP COLUMN "programEndDate",
DROP COLUMN "programRtfSnapshot",
DROP COLUMN "programStartDate",
DROP COLUMN "programStartWeek",
DROP COLUMN "programStyle",
DROP COLUMN "programTimezone",
DROP COLUMN "programTrainingDaysOfWeek",
DROP COLUMN "programWithDeloads";

-- AlterTable
ALTER TABLE "RoutineExercise" DROP COLUMN "programLastAdjustedWeek",
DROP COLUMN "programRoundingKg",
DROP COLUMN "programStyle",
DROP COLUMN "programTMKg";

-- DropTable
DROP TABLE "TmAdjustment";

-- DropEnum
DROP TYPE "ProgramStyle";
