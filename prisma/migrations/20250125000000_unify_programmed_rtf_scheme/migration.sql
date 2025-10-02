-- Migration: Unify PROGRAMMED_RTF progression scheme with exercise-level programStyle
-- This migration adds exercise-level programStyle support and migrates existing PROGRAMMED_RTF_HYPERTROPHY data

-- Step 1: Add programStyle field to RoutineExercise
ALTER TABLE "RoutineExercise" ADD COLUMN "programStyle" "ProgramStyle";

-- Step 2: Migrate existing PROGRAMMED_RTF_HYPERTROPHY exercises to unified scheme
UPDATE "RoutineExercise" 
SET 
  "progressionScheme" = 'PROGRAMMED_RTF',
  "programStyle" = 'HYPERTROPHY'
WHERE "progressionScheme" = 'PROGRAMMED_RTF_HYPERTROPHY';

-- Step 3: Set STANDARD style for existing PROGRAMMED_RTF exercises
UPDATE "RoutineExercise" 
SET "programStyle" = 'STANDARD'
WHERE "progressionScheme" = 'PROGRAMMED_RTF' AND "programStyle" IS NULL;

-- Step 4: Update routine-level programStyle based on exercise composition
-- For routines with mixed styles, set to null (will be handled by frontend derivation)
UPDATE "Routine" 
SET "programStyle" = NULL
WHERE id IN (
  SELECT DISTINCT r.id
  FROM "Routine" r
  JOIN "RoutineDay" rd ON rd."routineId" = r.id
  JOIN "RoutineExercise" re ON re."routineDayId" = rd.id
  WHERE re."progressionScheme" = 'PROGRAMMED_RTF'
  GROUP BY r.id
  HAVING COUNT(DISTINCT re."programStyle") > 1
);

-- Step 5: For routines with single style, update routine-level programStyle
UPDATE "Routine" 
SET "programStyle" = (
  SELECT re."programStyle"
  FROM "RoutineDay" rd
  JOIN "RoutineExercise" re ON re."routineDayId" = rd.id
  WHERE rd."routineId" = "Routine".id 
    AND re."progressionScheme" = 'PROGRAMMED_RTF'
  LIMIT 1
)
WHERE id IN (
  SELECT DISTINCT r.id
  FROM "Routine" r
  JOIN "RoutineDay" rd ON rd."routineId" = r.id
  JOIN "RoutineExercise" re ON re."routineDayId" = rd.id
  WHERE re."progressionScheme" = 'PROGRAMMED_RTF'
  GROUP BY r.id
  HAVING COUNT(DISTINCT re."programStyle") = 1
);

-- Note: PROGRAMMED_RTF_HYPERTROPHY enum value removal will be handled in a separate migration
-- after confirming all applications are updated to use the unified scheme