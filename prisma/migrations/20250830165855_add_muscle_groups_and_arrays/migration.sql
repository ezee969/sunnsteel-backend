/*
  Warnings:

  - You are about to drop the column `primaryMuscle` on the `Exercise` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "MuscleGroup" AS ENUM ('PECTORAL', 'LATISSIMUS_DORSI', 'TRAPEZIUS', 'REAR_DELTOIDS', 'ERECTOR_SPINAE', 'TERES_MAJOR_MINOR', 'ANTERIOR_DELTOIDS', 'MEDIAL_DELTOIDS', 'BICEPS', 'FOREARMS', 'TRICEPS', 'QUADRICEPS', 'HAMSTRINGS', 'GLUTES', 'CALVES', 'CORE');

-- AlterTable
ALTER TABLE "Exercise" DROP COLUMN "primaryMuscle",
ADD COLUMN     "primaryMuscles" "MuscleGroup"[],
ADD COLUMN     "secondaryMuscles" "MuscleGroup"[];
