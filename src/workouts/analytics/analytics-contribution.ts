import { createHash } from 'node:crypto';
import { WorkoutSessionSnapshotV1 } from '@sunsteel/contracts';

export const dayDifference = (later: string, earlier: string) =>
  Math.round(
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) /
      86400000,
  );

export function localDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function weekDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export interface AnalyticsLog {
  id: string;
  exerciseId: string;
  routineExerciseId: string | null;
  sourceRoutineExerciseId: string | null;
  weight: number | null;
  reps: number | null;
  isCompleted: boolean;
  completedAt: Date | null;
}

export function sessionContribution(
  logs: AnalyticsLog[],
  snapshot: WorkoutSessionSnapshotV1,
  endedAt: Date,
) {
  let volumeKg = 0;
  let completedSets = 0;
  const muscles = new Map<
    string,
    { volumeKg: number; completedSets: number }
  >();
  const records = new Map<
    string,
    {
      exerciseId: string;
      exerciseName: string;
      setLogId: string;
      weight: number;
      reps: number;
      estimated1rm: number;
      achievedAt: Date;
    }
  >();
  // Deterministic order, including exact ties, independent of database row order.
  const ordered = [...logs].sort(
    (a, b) =>
      (a.completedAt ?? endedAt).getTime() -
        (b.completedAt ?? endedAt).getTime() || a.id.localeCompare(b.id),
  );
  for (const log of ordered) {
    if (!log.isCompleted) continue;
    completedSets++;
    const volume = (log.weight ?? 0) * (log.reps ?? 0);
    volumeKg += volume;
    const exercise = snapshot.routineDay.exercises.find(
      (e) => e.id === (log.sourceRoutineExerciseId ?? log.routineExerciseId),
    )?.exercise;
    if (!exercise)
      throw new Error(`Missing snapshot exercise for set ${log.id}`);
    for (const [groups, factor] of [
      [exercise.primaryMuscles, 1],
      [exercise.secondaryMuscles ?? [], 0.5],
    ] as const) {
      for (const muscle of groups) {
        const previous = muscles.get(muscle) ?? {
          volumeKg: 0,
          completedSets: 0,
        };
        muscles.set(muscle, {
          volumeKg: previous.volumeKg + volume * factor,
          completedSets: previous.completedSets + factor,
        });
      }
    }
    const weight = log.weight ?? 0;
    const reps = log.reps ?? 0;
    if (weight <= 0 || reps <= 0) continue;
    const previous = records.get(log.exerciseId);
    if (
      !previous ||
      weight > previous.weight ||
      (weight === previous.weight && reps > previous.reps)
    ) {
      records.set(log.exerciseId, {
        exerciseId: log.exerciseId,
        exerciseName: exercise.name,
        setLogId: log.id,
        weight,
        reps,
        estimated1rm: Math.round(weight * (1 + reps / 30) * 10) / 10,
        achievedAt: log.completedAt ?? endedAt,
      });
    }
  }
  return {
    volumeKg,
    completedSets,
    muscles: [...muscles].sort(([a], [b]) => a.localeCompare(b)),
    records: [...records.values()],
  };
}

export function nextStreak(
  previous: {
    lastTrainingDate: string | null;
    currentRun: number;
    bestRun: number;
  },
  date: string,
) {
  if (previous.lastTrainingDate && date < previous.lastTrainingDate)
    throw new Error('Non-monotonic analytics contribution');
  const currentRun =
    date === previous.lastTrainingDate
      ? previous.currentRun
      : previous.lastTrainingDate &&
          dayDifference(date, previous.lastTrainingDate) <= 3
        ? previous.currentRun + 1
        : 1;
  return {
    lastTrainingDate: date,
    currentRun,
    bestRun: Math.max(previous.bestRun, currentRun),
  };
}

export function contributionChecksum(
  previous: string,
  sessionId: string,
  endedAt: Date,
  contribution: ReturnType<typeof sessionContribution>,
) {
  return createHash('sha256')
    .update(previous)
    .update(JSON.stringify({ sessionId, endedAt, ...contribution }))
    .digest('hex');
}
