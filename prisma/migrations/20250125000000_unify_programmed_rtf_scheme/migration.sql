-- Migration: Unify PROGRAMMED_RTF progression scheme with exercise-level programStyle
-- This migration adds exercise-level programStyle support and migrates existing PROGRAMMED_RTF_HYPERTROPHY data.
--
-- IMPORTANT:
-- This file may appear earlier than the migrations that create the routine tables/enums in some histories.
-- To keep `prisma migrate dev` working (incl. shadow DB), all steps are guarded and become no-ops
-- when the required tables/types/values don't exist yet.

-- Step 1: Add programStyle field to RoutineExercise (only when table + enum exist)
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'RoutineExercise'
  ) AND EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'ProgramStyle'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'RoutineExercise'
        AND column_name = 'programStyle'
    ) THEN
      EXECUTE 'ALTER TABLE "RoutineExercise" ADD COLUMN "programStyle" "ProgramStyle"';
    END IF;
  END IF;
END $do$;

-- Step 2: Migrate existing PROGRAMMED_RTF_HYPERTROPHY exercises to unified scheme
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'RoutineExercise'
  ) AND EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ProgressionScheme' AND e.enumlabel = 'PROGRAMMED_RTF_HYPERTROPHY'
  ) THEN
    EXECUTE $sql$
      UPDATE "RoutineExercise"
      SET
        "progressionScheme" = 'PROGRAMMED_RTF',
        "programStyle" = 'HYPERTROPHY'
      WHERE "progressionScheme" = 'PROGRAMMED_RTF_HYPERTROPHY'
    $sql$;
  END IF;
END $do$;

-- Step 3: Set STANDARD style for existing PROGRAMMED_RTF exercises
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'RoutineExercise'
  ) THEN
    EXECUTE $sql$
      UPDATE "RoutineExercise"
      SET "programStyle" = 'STANDARD'
      WHERE "progressionScheme" = 'PROGRAMMED_RTF' AND "programStyle" IS NULL
    $sql$;
  END IF;
END $do$;

-- Steps 4-5: Update routine-level programStyle based on exercise composition
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Routine'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Routine' AND column_name = 'programStyle'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'RoutineDay'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'RoutineExercise'
  ) THEN
    -- For routines with mixed styles, set to null (frontend derives display)
    EXECUTE $sql$
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
      )
    $sql$;

    -- For routines with single style, copy it to routine.programStyle
    EXECUTE $sql$
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
      )
    $sql$;
  END IF;
END $do$;