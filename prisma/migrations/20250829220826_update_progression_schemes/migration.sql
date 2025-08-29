/*
  Warnings:

  - The values [DYNAMIC,DYNAMIC_DOUBLE] on the enum `ProgressionScheme` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ProgressionScheme_new" AS ENUM ('NONE', 'DOUBLE_PROGRESSION', 'DYNAMIC_DOUBLE_PROGRESSION');
ALTER TABLE "RoutineExercise" ALTER COLUMN "progressionScheme" DROP DEFAULT;
ALTER TABLE "RoutineExercise" ALTER COLUMN "progressionScheme" TYPE "ProgressionScheme_new" USING ("progressionScheme"::text::"ProgressionScheme_new");
ALTER TYPE "ProgressionScheme" RENAME TO "ProgressionScheme_old";
ALTER TYPE "ProgressionScheme_new" RENAME TO "ProgressionScheme";
DROP TYPE "ProgressionScheme_old";
ALTER TABLE "RoutineExercise" ALTER COLUMN "progressionScheme" SET DEFAULT 'NONE';
COMMIT;

-- AlterTable
ALTER TABLE "RoutineExercise" ALTER COLUMN "progressionScheme" SET DEFAULT 'NONE';
