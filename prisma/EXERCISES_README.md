# Exercise Management Guide

This guide explains how to manage exercises in the Sunnsteel fitness application database.

## Overview

The exercise catalog contains 85+ predefined exercises with:
- **Primary muscles**: Main muscle groups targeted (counts as 1.0 for volume)
- **Secondary muscles**: Supporting muscle groups (counts as 0.5 for volume)
- **Equipment**: Type of equipment required (barbell, dumbbell, cable, machine, bodyweight)

## Scripts

### 1. Full Database Seed (`seed.ts`)

**Purpose**: Initialize or update the complete exercise catalog

**Command**:
```bash
npm run db:seed
```

**Behavior**:
- Uses **upsert** to preserve existing exercise IDs
- Updates exercise data if the name already exists
- Creates new exercises if they don't exist
- **Safe for production**: Maintains referential integrity with existing routines

**When to use**:
- Initial database setup
- Updating multiple existing exercises
- Adding many new exercises at once

### 2. Add New Exercises (`add-exercises.ts`)

**Purpose**: Safely add individual exercises without running the full seed

**Command**:
```bash
npm run db:add-exercises
```

**How to use**:
1. Open `prisma/add-exercises.ts`
2. Add your new exercises to the `newExercises` array:
   ```typescript
   const newExercises: ExerciseSeed[] = [
     {
       name: "Farmer's Walk",
       primaryMuscles: [MuscleGroup.FOREARMS, MuscleGroup.CORE],
       secondaryMuscles: [MuscleGroup.TRAPEZIUS],
       equipment: 'dumbbell',
     },
     {
       name: 'Face Pull',
       primaryMuscles: [MuscleGroup.REAR_DELTOIDS],
       secondaryMuscles: [MuscleGroup.TRAPEZIUS],
       equipment: 'cable',
     },
   ]
   ```
3. Run the command
4. The script will:
   - Create new exercises
   - Skip exercises that already exist (by name)
   - Show a summary of created/skipped exercises

**When to use**:
- Adding 1-10 new exercises
- Quick additions without touching the main seed file
- Testing new exercise definitions

## Available Muscle Groups

```typescript
enum MuscleGroup {
  PECTORAL
  LATISSIMUS_DORSI
  TRAPEZIUS
  REAR_DELTOIDS
  ERECTOR_SPINAE
  TERES_MAJOR_MINOR
  ANTERIOR_DELTOIDS
  MEDIAL_DELTOIDS
  BICEPS
  FOREARMS
  TRICEPS
  QUADRICEPS
  HAMSTRINGS
  GLUTES
  CALVES
  CORE
}
```

## Equipment Types

Common equipment values:
- `'barbell'`
- `'dumbbell'`
- `'cable'`
- `'machine'`
- `'bodyweight'`

## Important Notes

### ID Stability
- Exercise IDs are **stable** across seed runs
- The `name` field serves as the unique identifier
- Existing routines maintain their exercise references

### Name Uniqueness
- Exercise names must be unique
- Names are case-sensitive
- Use consistent naming conventions (e.g., "Bench Press" not "bench press")

### Updating Exercises
To update an existing exercise:
1. Modify the exercise data in `seed.ts`
2. Run `npm run db:seed`
3. The upsert will update the exercise while preserving its ID

### Deleting Exercises
⚠️ **Warning**: Deleting exercises is not supported by these scripts because:
- Existing routines may reference the exercise
- Database foreign key constraints prevent deletion
- Manual deletion requires careful handling of dependent data

If you need to remove an exercise, consider:
1. Marking it as deprecated (requires schema change)
2. Manually removing it via database admin tools after verifying no routines use it

## Example Workflow

### Adding a New Exercise

1. **Quick add** (for 1-2 exercises):
   ```bash
   # Edit prisma/add-exercises.ts
   # Add your exercise to newExercises array
   npm run db:add-exercises
   ```

2. **Permanent addition** (for catalog expansion):
   ```bash
   # Edit prisma/seed.ts
   # Add your exercise to the exercises array
   npm run db:seed
   ```

### Updating Exercise Data

```bash
# Edit the exercise in prisma/seed.ts
# Change muscle groups, equipment, etc.
npm run db:seed
# The exercise will be updated while keeping its ID
```

## Troubleshooting

### "Exercise already exists"
- This is expected behavior when using `add-exercises.ts`
- The script skips existing exercises to prevent duplicates
- If you want to update an exercise, use `seed.ts` instead

### "Foreign key constraint violation"
- You're trying to delete an exercise that's used in routines
- Check which routines reference the exercise before deletion
- Consider updating the exercise data instead of deleting

### "Unique constraint violation on name"
- Two exercises have the same name
- Exercise names must be unique
- Check for typos or use more specific names (e.g., "Barbell Row" vs "Dumbbell Row")
