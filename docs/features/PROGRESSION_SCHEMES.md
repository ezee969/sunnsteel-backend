# Progression Schemes

Exercise-specific progression tracking system for the Sunnsteel Backend API.

## Overview

Progression schemes define how individual exercises advance in weight, reps, or intensity over time. **Each exercise within a routine has its own progression scheme**, allowing for granular control over training progression.

**Updated January 2025**: The system now uses a unified `PROGRAMMED_RTF` progression scheme with exercise-level `programStyle` differentiation for RtF variants.

## Key Principles

### Exercise-Level Progression
- **Individual Control**: Each exercise can have a different progression scheme
- **Granular Management**: Progression is tracked per exercise, not per routine
- **Flexible Programming**: Mix different progression types within a single routine
- **Style Differentiation**: RtF exercises use `programStyle` for Standard/Hypertrophy variants

### Routine-Level Classification
- **Deprecated Pattern**: Routines should NOT be classified by a single progression scheme
- **Correct Approach**: Routines contain exercises, each with their own progression scheme
- **Data Storage**: `progressionScheme` is stored at the `RoutineExercise` level
- **Style Storage**: `programStyle` is stored at the `RoutineExercise` level for RtF exercises

## Progression Scheme Types

### 1. NONE
- **Purpose**: No automatic progression
- **Use Case**: Maintenance phases, rehabilitation, or static training
- **Behavior**: Weight and reps remain constant

### 2. DYNAMIC
- **Purpose**: Traditional double progression system
- **Mechanism**: Increase reps first, then weight when rep target is reached
- **Example**: 3x8-12 → increase weight when all sets reach 12 reps

### 3. DYNAMIC_DOUBLE
- **Purpose**: Individual set progression
- **Mechanism**: Each set progresses independently
- **Flexibility**: Allows for uneven progression across sets

### 4. PROGRAMMED_RTF ⭐ UNIFIED SCHEME
- **Purpose**: Reps-to-Failure programming with style variants
- **Style Variants**: Controlled by `programStyle` field
  - **STANDARD**: Traditional 5+1 set structure (4 fixed + 1 AMRAP)
  - **HYPERTROPHY**: Volume-focused 3+1 set structure (2 fixed + 1 AMRAP)
- **Features**:
  - Calendar-based progression
  - Weekly intensity targets
  - Automatic Training Max adjustments
  - AMRAP (As Many Reps As Possible) sets
  - Exercise-level style differentiation

#### Program Style Differentiation

**STANDARD Style** (`programStyle: 'STANDARD'`):
- 5 sets per occurrence (4 fixed + 1 AMRAP)
- Traditional strength-focused progression
- Higher intensity, lower volume

**HYPERTROPHY Style** (`programStyle: 'HYPERTROPHY'`):
- 3 sets per occurrence (2 fixed + 1 AMRAP)
- Volume-focused progression
- Moderate intensity, higher frequency

## Database Schema

### RoutineExercise Model
```prisma
model RoutineExercise {
  id                String            @id @default(uuid())
  routineDayId      String
  exerciseId        String
  progressionScheme ProgressionScheme @default(NONE)
  programStyle      ProgramStyle?     // Required for PROGRAMMED_RTF exercises
  // ... other fields
}

enum ProgressionScheme {
  NONE
  DYNAMIC
  DYNAMIC_DOUBLE
  PROGRAMMED_RTF                    // Unified RtF scheme
}

enum ProgramStyle {
  STANDARD
  HYPERTROPHY
}
```

### Validation Rules
- `programStyle` is **required** when `progressionScheme = 'PROGRAMMED_RTF'`
- `programStyle` is **ignored** for other progression schemes
- Mixed-style routines are fully supported (different exercises can have different styles)

## API Implementation

### Creating Routines with Exercise-Specific Progression

**Endpoint**: `POST /api/routines`

**Request Structure** (Updated for Unified Scheme):
```json
{
  "name": "Mixed Style Routine",
  "days": [
    {
      "name": "Upper Body",
      "exercises": [
        {
          "exerciseId": "bench-press-id",
          "progressionScheme": "DYNAMIC",
          "sets": [...]
        },
        {
          "exerciseId": "overhead-press-id", 
          "progressionScheme": "PROGRAMMED_RTF",
          "programStyle": "STANDARD",
          "sets": [...]
        },
        {
          "exerciseId": "lateral-raise-id",
          "progressionScheme": "PROGRAMMED_RTF", 
          "programStyle": "HYPERTROPHY",
          "sets": [...]
        }
      ]
    }
  ]
}
```

### Retrieving Exercise Progression Data

**Endpoint**: `GET /api/routines/:id`

**Response Structure** (Updated):
```json
{
  "id": "routine-id",
  "name": "Mixed Style Routine",
  "days": [
    {
      "exercises": [
        {
          "id": "exercise-1",
          "progressionScheme": "DYNAMIC",
          "programStyle": null,
          "exercise": {
            "name": "Bench Press"
          },
          "sets": [...]
        },
        {
          "id": "exercise-2", 
          "progressionScheme": "PROGRAMMED_RTF",
          "programStyle": "STANDARD",
          "programTMKg": 100.0,
          "exercise": {
            "name": "Overhead Press"
          },
          "sets": [...]
        },
        {
          "id": "exercise-3",
          "progressionScheme": "PROGRAMMED_RTF",
          "programStyle": "HYPERTROPHY",
          "programTMKg": 80.0,
          "exercise": {
            "name": "Lateral Raise"
          },
          "sets": [...]
        }
      ]
    }
  ]
}
```

## Frontend Integration (Pending Updates)

### Current Status ⚠️ NEEDS UPDATE

The frontend components still reference the old dual progression scheme approach and need to be updated to work with the unified `PROGRAMMED_RTF` + `programStyle` implementation.

### ExerciseCard Component (Needs Update)

The `ExerciseCard` component should be updated to:

1. **Display Progression Badge**: Show unified `PROGRAMMED_RTF` with style indicator
2. **Style Differentiation**: Display `programStyle` for RtF exercises
3. **Mixed-Style Support**: Handle routines with different exercise styles
4. **Conditional Rendering**: Different UI based on `programStyle`

**Updated Implementation Needed**:
```typescript
// Determine if this is an RtF exercise
const isRtfExercise = exercise.progressionScheme === 'PROGRAMMED_RTF';

// Display progression scheme with style
{exercise.progressionScheme && (
  <Badge variant="outline" className="text-xs">
    {exercise.progressionScheme === 'PROGRAMMED_RTF' 
      ? `RtF ${exercise.programStyle || 'STANDARD'}`
      : exercise.progressionScheme.replace(/_/g, ' ')
    }
  </Badge>
)}
```

## Backend Service Updates

### RoutinesService.findOne()

**Updated Query**: Includes exercise-level progression fields
```typescript
select: {
  exercises: {
    select: {
      id: true,
      progressionScheme: true,  // ✅ Added
      programTMKg: true,        // ✅ Added  
      programRoundingKg: true,  // ✅ Added
      minWeightIncrement: true, // ✅ Added
      // ... other fields
    }
  }
}
```

## Migration Considerations

### From Routine-Level to Exercise-Level

1. **Data Migration**: Move progression schemes from routine to exercise level
2. **API Updates**: Update endpoints to handle exercise-specific progression
3. **Frontend Updates**: Modify components to use exercise.progressionScheme
4. **Validation**: Ensure progression schemes are valid for each exercise type

### Backward Compatibility

- **Graceful Degradation**: Handle missing progressionScheme fields
- **Default Values**: Use NONE as default progression scheme
- **Migration Scripts**: Convert existing routine-level data

## Best Practices

### Exercise Selection
- **Match Progression to Exercise**: Choose appropriate schemes for exercise types
- **Consider Training Goals**: Align progression with training objectives
- **Program Coherence**: Ensure progression schemes work together within routines

### Data Validation
- **Enum Validation**: Validate progression scheme values
- **Exercise Compatibility**: Ensure schemes are appropriate for exercise types
- **Required Fields**: Validate required fields for specific progression types

### Performance Optimization
- **Selective Queries**: Only fetch progression data when needed
- **Caching**: Cache progression calculations for RtF exercises
- **Indexing**: Index progression scheme fields for efficient queries

## Monitoring & Metrics

### Progression Tracking
- **Usage Metrics**: Track progression scheme adoption
- **Performance Metrics**: Monitor progression calculation performance
- **Success Rates**: Track progression success and failure rates

### RtF-Specific Metrics
- **TM Adjustments**: Monitor Training Max adjustment frequency
- **Cache Performance**: Track RtF week goals cache efficiency
- **Forecast Accuracy**: Measure RtF progression forecast accuracy

## Related Documentation

- **[RtF Programs](RTF_PROGRAMS.md)** - Detailed RtF implementation
- **[Training Max Adjustments](TRAINING_MAX_ADJUSTMENTS.md)** - TM progression system
- **[Workout Sessions](WORKOUT_SESSIONS.md)** - Session-based progression tracking
- **[Multi-Layer Caching](MULTI_LAYER_CACHING.md)** - RtF caching architecture

---

*Last Updated: January 2025*  
*This documentation reflects the corrected exercise-specific progression architecture.*