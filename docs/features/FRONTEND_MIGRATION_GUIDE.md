# Frontend Migration Guide: Unified PROGRAMMED_RTF Implementation

## Overview

This guide provides comprehensive instructions for updating the frontend to work with the unified `PROGRAMMED_RTF` progression scheme implementation completed in the backend (January 2025).

## Backend Changes Summary

### ✅ Completed Backend Updates

1. **Unified Progression Scheme**: Removed `PROGRAMMED_RTF_HYPERTROPHY` enum value
2. **Exercise-Level Styling**: Added `programStyle` field to `RoutineExercise` model
3. **Mixed-Style Support**: Backend now supports routines with different exercise styles
4. **Comprehensive Testing**: All backend tests passing with new implementation

### Current Backend Schema

```typescript
enum ProgressionScheme {
  NONE
  DYNAMIC
  DYNAMIC_DOUBLE
  PROGRAMMED_RTF                    // Unified RtF scheme
  // PROGRAMMED_RTF_HYPERTROPHY - REMOVED
}

enum ProgramStyle {
  STANDARD
  HYPERTROPHY
}

interface RoutineExercise {
  progressionScheme: ProgressionScheme
  programStyle?: ProgramStyle       // Required for PROGRAMMED_RTF exercises
}
```

## Required Frontend Updates

### 1. Type Definitions

#### Update API Types

**File**: `lib/api/types/routine.type.ts` (or equivalent)

```typescript
// BEFORE (needs update):
interface RoutineExercise {
  progressionScheme: 'PROGRAMMED_RTF' | 'PROGRAMMED_RTF_HYPERTROPHY' | 'DYNAMIC' | 'DYNAMIC_DOUBLE' | 'NONE'
}

// AFTER (updated):
interface RoutineExercise {
  progressionScheme: 'PROGRAMMED_RTF' | 'DYNAMIC' | 'DYNAMIC_DOUBLE' | 'NONE'
  programStyle?: 'STANDARD' | 'HYPERTROPHY'  // Required for PROGRAMMED_RTF
}
```

#### Update Form Types

```typescript
// BEFORE:
type RtfProgressionScheme = 'PROGRAMMED_RTF' | 'PROGRAMMED_RTF_HYPERTROPHY'

// AFTER:
type RtfProgressionScheme = 'PROGRAMMED_RTF'
type RtfProgramStyle = 'STANDARD' | 'HYPERTROPHY'
```

### 2. Utility Functions

#### Update Progression Scheme Helpers

```typescript
// BEFORE (needs update):
const getRtfStyle = (exercise: RoutineWizardExercise | undefined) => {
  switch (exercise?.progressionScheme) {
    case 'PROGRAMMED_RTF_HYPERTROPHY': return 'HYPERTROPHY'
    case 'PROGRAMMED_RTF': return 'STANDARD'
    default: return undefined
  }
}

// AFTER (updated):
const getRtfStyle = (exercise: RoutineWizardExercise | undefined) => {
  if (exercise?.progressionScheme === 'PROGRAMMED_RTF') {
    return exercise.programStyle || 'STANDARD'
  }
  return undefined
}

const isRtfExercise = (exercise: RoutineWizardExercise) => {
  return exercise.progressionScheme === 'PROGRAMMED_RTF'
}

const getRtfDisplayName = (exercise: RoutineWizardExercise) => {
  if (exercise.progressionScheme === 'PROGRAMMED_RTF') {
    const style = exercise.programStyle || 'STANDARD'
    return `RtF ${style}`
  }
  return exercise.progressionScheme?.replace(/_/g, ' ')
}
```

### 3. Form Components

#### Routine Creation/Edit Forms

```typescript
// Update form submission to use unified scheme
const handleExerciseSubmit = (exerciseData: ExerciseFormData) => {
  const exercise = {
    ...exerciseData,
    progressionScheme: exerciseData.rtfStyle 
      ? 'PROGRAMMED_RTF' 
      : exerciseData.progressionScheme,
    programStyle: exerciseData.rtfStyle || undefined
  }
  
  // Remove old rtfStyle field
  delete exercise.rtfStyle
  
  return exercise
}
```

#### Exercise Selection Component

```typescript
// Update progression scheme options
const progressionOptions = [
  { value: 'NONE', label: 'No Progression' },
  { value: 'DYNAMIC', label: 'Dynamic Progression' },
  { value: 'DYNAMIC_DOUBLE', label: 'Double Progression' },
  { value: 'PROGRAMMED_RTF', label: 'RtF Program' }
]

// Add style selection for RtF exercises
const rtfStyleOptions = [
  { value: 'STANDARD', label: 'Standard (5+1 sets)' },
  { value: 'HYPERTROPHY', label: 'Hypertrophy (3+1 sets)' }
]

// Conditional rendering
{selectedProgressionScheme === 'PROGRAMMED_RTF' && (
  <Select
    value={programStyle}
    onValueChange={setProgramStyle}
    required
  >
    <SelectTrigger>
      <SelectValue placeholder="Select RtF style" />
    </SelectTrigger>
    <SelectContent>
      {rtfStyleOptions.map(option => (
        <SelectItem key={option.value} value={option.value}>
          {option.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
)}
```

### 4. Display Components

#### Exercise Card Component

```typescript
// Update badge display
const ExerciseCard = ({ exercise }: { exercise: RoutineExercise }) => {
  const getProgressionBadge = () => {
    if (exercise.progressionScheme === 'PROGRAMMED_RTF') {
      const style = exercise.programStyle || 'STANDARD'
      return `RtF ${style}`
    }
    return exercise.progressionScheme?.replace(/_/g, ' ')
  }

  return (
    <div className="exercise-card">
      <Badge variant="outline" className="text-xs">
        {getProgressionBadge()}
      </Badge>
      {/* Rest of component */}
    </div>
  )
}
```

#### Routine Summary Component

```typescript
// Update routine style detection for mixed-style support
const getRoutineStyles = (routine: Routine): string[] => {
  const styles = new Set<string>()
  
  routine.days?.forEach(day => {
    day.exercises?.forEach(exercise => {
      if (exercise.progressionScheme === 'PROGRAMMED_RTF') {
        styles.add(exercise.programStyle || 'STANDARD')
      }
    })
  })
  
  return Array.from(styles)
}

const RoutineSummary = ({ routine }: { routine: Routine }) => {
  const rtfStyles = getRoutineStyles(routine)
  
  return (
    <div>
      {rtfStyles.length > 0 && (
        <div className="rtf-styles">
          {rtfStyles.length === 1 ? (
            <Badge>RtF {rtfStyles[0]}</Badge>
          ) : (
            <Badge>Mixed RtF ({rtfStyles.join(', ')})</Badge>
          )}
        </div>
      )}
    </div>
  )
}
```

### 5. API Integration

#### Update API Calls

```typescript
// Ensure API calls send correct data structure
const createRoutine = async (routineData: CreateRoutineRequest) => {
  // Transform frontend data to backend format
  const transformedData = {
    ...routineData,
    days: routineData.days.map(day => ({
      ...day,
      exercises: day.exercises.map(exercise => ({
        ...exercise,
        // Ensure PROGRAMMED_RTF exercises have programStyle
        progressionScheme: exercise.progressionScheme,
        programStyle: exercise.progressionScheme === 'PROGRAMMED_RTF' 
          ? exercise.programStyle || 'STANDARD'
          : undefined
      }))
    }))
  }
  
  return api.post('/api/routines', transformedData)
}
```

### 6. Validation

#### Form Validation Rules

```typescript
// Update validation schema
const exerciseValidationSchema = z.object({
  progressionScheme: z.enum(['NONE', 'DYNAMIC', 'DYNAMIC_DOUBLE', 'PROGRAMMED_RTF']),
  programStyle: z.enum(['STANDARD', 'HYPERTROPHY']).optional(),
  // ... other fields
}).refine((data) => {
  // Require programStyle for PROGRAMMED_RTF exercises
  if (data.progressionScheme === 'PROGRAMMED_RTF' && !data.programStyle) {
    return false
  }
  return true
}, {
  message: "Program style is required for RtF exercises",
  path: ["programStyle"]
})
```

### 7. Migration Checklist

#### Phase 1: Type Updates
- [ ] Update API type definitions
- [ ] Update form type definitions
- [ ] Update component prop types
- [ ] Remove references to `PROGRAMMED_RTF_HYPERTROPHY`

#### Phase 2: Utility Functions
- [ ] Update progression scheme helpers
- [ ] Update display name functions
- [ ] Update validation functions
- [ ] Add mixed-style detection utilities

#### Phase 3: Components
- [ ] Update exercise selection forms
- [ ] Update exercise display cards
- [ ] Update routine summary components
- [ ] Update progression badges

#### Phase 4: API Integration
- [ ] Update create routine API calls
- [ ] Update edit routine API calls
- [ ] Update form submission handlers
- [ ] Test API integration

#### Phase 5: Testing
- [ ] Test single-style routines (STANDARD only)
- [ ] Test single-style routines (HYPERTROPHY only)
- [ ] Test mixed-style routines
- [ ] Test form validation
- [ ] Test API error handling

## Testing Scenarios

### Test Cases to Verify

1. **Single Style Routines**
   - Create routine with all STANDARD RtF exercises
   - Create routine with all HYPERTROPHY RtF exercises
   - Verify correct `programStyle` is sent to backend

2. **Mixed Style Routines**
   - Create routine with both STANDARD and HYPERTROPHY exercises
   - Verify each exercise has correct `programStyle`
   - Verify routine displays as "Mixed RtF"

3. **Non-RtF Exercises**
   - Create routine with DYNAMIC/DYNAMIC_DOUBLE exercises
   - Verify no `programStyle` is sent for non-RtF exercises
   - Verify mixed routines with RtF and non-RtF exercises

4. **Form Validation**
   - Verify `programStyle` is required when selecting PROGRAMMED_RTF
   - Verify form prevents submission without required fields
   - Verify error messages are clear and helpful

5. **API Error Handling**
   - Test backend validation errors
   - Verify proper error display to users
   - Test network error scenarios

## Backend API Reference

### Current Endpoint Behavior

**POST /api/routines**
```json
{
  "name": "Mixed Style Routine",
  "days": [
    {
      "exercises": [
        {
          "exerciseId": "bench-press-id",
          "progressionScheme": "PROGRAMMED_RTF",
          "programStyle": "STANDARD",
          "programTMKg": 100.0,
          "sets": [...]
        },
        {
          "exerciseId": "lateral-raise-id", 
          "progressionScheme": "PROGRAMMED_RTF",
          "programStyle": "HYPERTROPHY",
          "programTMKg": 30.0,
          "sets": [...]
        }
      ]
    }
  ]
}
```

**Response includes exercise-level `programStyle`**:
```json
{
  "id": "routine-id",
  "days": [
    {
      "exercises": [
        {
          "id": "exercise-1",
          "progressionScheme": "PROGRAMMED_RTF",
          "programStyle": "STANDARD",
          "exercise": { "name": "Bench Press" }
        },
        {
          "id": "exercise-2",
          "progressionScheme": "PROGRAMMED_RTF", 
          "programStyle": "HYPERTROPHY",
          "exercise": { "name": "Lateral Raise" }
        }
      ]
    }
  ]
}
```

## Support

For questions about the backend implementation or API behavior:
- Check the comprehensive test suite in `test/comprehensive/unified-rtf-implementation.e2e-spec.ts`
- Review the backend documentation in `docs/analysis/PROGRAM_STYLE_ANALYSIS.md`
- Reference the progression schemes documentation in `docs/features/PROGRESSION_SCHEMES.md`

---

*Last Updated: January 2025*  
*Backend Implementation: ✅ Complete | Frontend Updates: 🔄 Pending*