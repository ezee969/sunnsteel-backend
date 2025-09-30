# Progression Schemes

Exercise-specific progression tracking system for the Sunnsteel Backend API.

## Overview

Progression schemes define how individual exercises advance in weight, reps, or intensity over time. **Each exercise within a routine has its own progression scheme**, allowing for granular control over training progression.

## Key Principles

### Exercise-Level Progression
- **Individual Control**: Each exercise can have a different progression scheme
- **Granular Management**: Progression is tracked per exercise, not per routine
- **Flexible Programming**: Mix different progression types within a single routine

### Routine-Level Classification
- **Deprecated Pattern**: Routines should NOT be classified by a single progression scheme
- **Correct Approach**: Routines contain exercises, each with their own progression scheme
- **Data Storage**: `progressionScheme` is stored at the `RoutineExercise` level

## Progression Scheme Types

### 1. NONE
- **Purpose**: No automatic progression
- **Use Case**: Maintenance phases, rehabilitation, or static training
- **Behavior**: Weight and reps remain constant

### 2. DOUBLE_PROGRESSION
- **Purpose**: Traditional double progression system
- **Mechanism**: Increase reps first, then weight when rep target is reached
- **Example**: 3x8-12 → increase weight when all sets reach 12 reps

### 3. DYNAMIC_DOUBLE_PROGRESSION
- **Purpose**: Individual set progression
- **Mechanism**: Each set progresses independently
- **Flexibility**: Allows for uneven progression across sets

### 4. PROGRAMMED_RTF
- **Purpose**: Reps-to-Failure programming (Standard variant)
- **Features**:
  - Calendar-based progression
  - Weekly intensity targets
  - Automatic Training Max adjustments
  - AMRAP (As Many Reps As Possible) sets

### 5. PROGRAMMED_RTF_HYPERTROPHY
- **Purpose**: Reps-to-Failure programming (Hypertrophy variant)
- **Features**:
  - Higher volume focus
  - Modified intensity curves
  - Hypertrophy-optimized rep ranges

## Database Schema

### RoutineExercise Model
```prisma
model RoutineExercise {
  id                String            @id @default(uuid())
  routineDayId      String
  exerciseId        String
  progressionScheme ProgressionScheme @default(NONE)
  // ... other fields
}

enum ProgressionScheme {
  NONE
  DOUBLE_PROGRESSION
  DYNAMIC_DOUBLE_PROGRESSION
  PROGRAMMED_RTF
  PROGRAMMED_RTF_HYPERTROPHY
}
```

## API Implementation

### Creating Routines with Exercise-Specific Progression

**Endpoint**: `POST /api/routines`

**Request Structure**:
```json
{
  "name": "Push/Pull/Legs",
  "days": [
    {
      "name": "Push Day",
      "exercises": [
        {
          "exerciseId": "bench-press-id",
          "progressionScheme": "DOUBLE_PROGRESSION",
          "sets": [...]
        },
        {
          "exerciseId": "overhead-press-id", 
          "progressionScheme": "PROGRAMMED_RTF",
          "sets": [...]
        }
      ]
    }
  ]
}
```

### Retrieving Exercise Progression Data

**Endpoint**: `GET /api/routines/:id`

**Response Structure**:
```json
{
  "id": "routine-id",
  "name": "Push/Pull/Legs",
  "days": [
    {
      "exercises": [
        {
          "id": "exercise-1",
          "progressionScheme": "DOUBLE_PROGRESSION",
          "programTMKg": null,
          "exercise": {
            "name": "Bench Press"
          },
          "sets": [...]
        },
        {
          "id": "exercise-2", 
          "progressionScheme": "PROGRAMMED_RTF",
          "programTMKg": 100.0,
          "exercise": {
            "name": "Overhead Press"
          },
          "sets": [...]
        }
      ]
    }
  ]
}
```

## Frontend Integration

### ExerciseCard Component

The `ExerciseCard` component uses the exercise-level `progressionScheme` to:

1. **Display Progression Badge**: Shows the specific progression type
2. **Conditional Rendering**: Different UI for RtF vs traditional schemes
3. **RtF Integration**: Fetches week goals for PROGRAMMED_RTF exercises
4. **Variant Display**: Shows STANDARD vs HYPERTROPHY variants

**Key Implementation**:
```typescript
// Determine if this is an RtF exercise based on progressionScheme
const isRtfExercise = exercise.progressionScheme && 
  isRtfProgressionScheme(exercise.progressionScheme);

// Display progression scheme badge
{exercise.progressionScheme && (
  <Badge variant="outline" className="text-xs">
    {exercise.progressionScheme.replace(/_/g, ' ')}
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