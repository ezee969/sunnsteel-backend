import type { ProgressionChange, ProgressionScheme } from '@sunsteel/contracts';

type PrescriptionSet = {
  setNumber: number;
  repType: 'FIXED' | 'RANGE';
  reps?: number | null;
  minReps?: number | null;
  maxReps?: number | null;
  weight?: number | null;
};

type PrescriptionExercise = {
  id: string;
  exerciseId?: string;
  exercise: { id?: string; name: string };
  progressionScheme: ProgressionScheme;
  minWeightIncrement?: number | null;
  sets: PrescriptionSet[];
};

export type ProgressionLog = {
  routineExerciseId: string;
  setNumber: number;
  reps: number | null;
  weight: number | null;
  isCompleted: boolean;
};

export type ProgressionUpdate = {
  routineExerciseId: string;
  setNumber: number;
  newWeight: number;
};

const logKey = (routineExerciseId: string, setNumber: number) =>
  `${routineExerciseId}#${setNumber}`;

const targetFor = (set: PrescriptionSet) =>
  set.repType === 'RANGE' ? (set.maxReps ?? null) : (set.reps ?? null);

const baseWeight = (set: PrescriptionSet, log?: ProgressionLog) =>
  typeof log?.weight === 'number'
    ? log.weight
    : typeof set.weight === 'number'
      ? set.weight
      : 0;

const hitTarget = (set: PrescriptionSet, log?: ProgressionLog) => {
  const target = targetFor(set);
  return (
    log?.isCompleted === true &&
    typeof target === 'number' &&
    typeof log.reps === 'number' &&
    log.reps >= target
  );
};

const carryLoggedWeight = (
  updates: ProgressionUpdate[],
  exercise: PrescriptionExercise,
  set: PrescriptionSet,
  log?: ProgressionLog,
) => {
  if (typeof log?.weight !== 'number') return;
  updates.push({
    routineExerciseId: exercise.id,
    setNumber: set.setNumber,
    newWeight: log.weight,
  });
};

export function buildProgressionOutcome(
  exercises: PrescriptionExercise[],
  logs: ProgressionLog[],
): { updates: ProgressionUpdate[]; changes: ProgressionChange[] } {
  const logMap = new Map(
    logs.map((log) => [
      logKey(log.routineExerciseId, log.setNumber),
      log,
    ]),
  );
  const updates: ProgressionUpdate[] = [];
  const changes: ProgressionChange[] = [];

  for (const exercise of exercises) {
    const increment = exercise.minWeightIncrement ?? 2.5;
    const logFor = (set: PrescriptionSet) =>
      logMap.get(logKey(exercise.id, set.setNumber));

    if (exercise.progressionScheme === 'DOUBLE_PROGRESSION') {
      const allSetsHit =
        exercise.sets.length > 0 &&
        exercise.sets.every((set) => hitTarget(set, logFor(set)));

      if (!allSetsHit) {
        exercise.sets.forEach((set) =>
          carryLoggedWeight(updates, exercise, set, logFor(set)),
        );
        continue;
      }

      const changedSets = exercise.sets.map((set) => {
        const log = logFor(set)!;
        const previousWeightKg = baseWeight(set, log);
        const newWeightKg = previousWeightKg + increment;
        updates.push({
          routineExerciseId: exercise.id,
          setNumber: set.setNumber,
          newWeight: newWeightKg,
        });
        return {
          setNumber: set.setNumber,
          targetReps: targetFor(set)!,
          performedReps: log.reps!,
          previousWeightKg,
          newWeightKg,
        };
      });
      changes.push({
        routineExerciseId: exercise.id,
        exerciseId: exercise.exerciseId ?? exercise.exercise.id!,
        exerciseName: exercise.exercise.name,
        progressionScheme: 'DOUBLE_PROGRESSION',
        rule: 'ALL_SETS_REACHED_TARGET',
        minWeightIncrementKg: increment,
        sets: changedSets,
      });
      continue;
    }

    if (exercise.progressionScheme === 'DYNAMIC_DOUBLE_PROGRESSION') {
      const changedSets = [] as ProgressionChange['sets'];
      for (const set of exercise.sets) {
        const log = logFor(set);
        if (!hitTarget(set, log)) {
          carryLoggedWeight(updates, exercise, set, log);
          continue;
        }
        const previousWeightKg = baseWeight(set, log);
        const newWeightKg = previousWeightKg + increment;
        updates.push({
          routineExerciseId: exercise.id,
          setNumber: set.setNumber,
          newWeight: newWeightKg,
        });
        changedSets.push({
          setNumber: set.setNumber,
          targetReps: targetFor(set)!,
          performedReps: log!.reps!,
          previousWeightKg,
          newWeightKg,
        });
      }
      if (changedSets.length > 0) {
        changes.push({
          routineExerciseId: exercise.id,
          exerciseId: exercise.exerciseId ?? exercise.exercise.id!,
          exerciseName: exercise.exercise.name,
          progressionScheme: 'DYNAMIC_DOUBLE_PROGRESSION',
          rule: 'SET_REACHED_TARGET',
          minWeightIncrementKg: increment,
          sets: changedSets,
        });
      }
      continue;
    }

    exercise.sets.forEach((set) =>
      carryLoggedWeight(updates, exercise, set, logFor(set)),
    );
  }

  return { updates, changes };
}
