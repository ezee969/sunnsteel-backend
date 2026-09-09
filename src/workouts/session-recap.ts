import type {
  PersonalRecordKind,
  SessionRecapRecord,
} from '@sunsteel/contracts';
import {
  recordFrontier,
  recordValues,
  type RecordSet,
} from './live-personal-records';

export interface RecapSet extends RecordSet {
  id: string;
  exerciseId: string;
  exerciseName: string;
  setNumber: number;
  completedAt: Date | null;
}

export interface HistoricalRecapSet extends RecordSet {
  exerciseId: string;
}

const RECORD_KINDS: PersonalRecordKind[] = [
  'WEIGHT',
  'REPS',
  'VOLUME',
  'ESTIMATED_1RM',
];

export function summarizeRecapSets(sets: RecordSet[]) {
  return sets.reduce(
    (summary, set) => {
      if (!set.isCompleted) return summary;
      return {
        completedSets: summary.completedSets + 1,
        totalVolumeKg:
          summary.totalVolumeKg + (set.weight ?? 0) * (set.reps ?? 0),
      };
    },
    { completedSets: 0, totalVolumeKg: 0 },
  );
}

/**
 * Rebuild the final record frontier earned by a session from persisted sets.
 * One stable best per exercise/kind is returned, even if live autosaves crossed
 * that frontier more than once during the workout.
 */
export function buildSessionRecapRecords(
  currentSets: RecapSet[],
  historicalSets: HistoricalRecapSet[],
  endedAt: Date,
): SessionRecapRecord[] {
  const historicalByExercise = new Map<string, HistoricalRecapSet[]>();
  for (const set of historicalSets) {
    const sets = historicalByExercise.get(set.exerciseId) ?? [];
    sets.push(set);
    historicalByExercise.set(set.exerciseId, sets);
  }

  const bestCurrent = new Map<
    string,
    { set: RecapSet; kind: PersonalRecordKind; value: number }
  >();
  for (const set of currentSets) {
    const values = recordValues(set);
    for (const kind of RECORD_KINDS) {
      const value = values[kind];
      if (value === null) continue;
      const key = `${set.exerciseId}:${kind}`;
      const best = bestCurrent.get(key);
      if (
        !best ||
        value > best.value ||
        (value === best.value &&
          (set.completedAt ?? endedAt).getTime() <
            (best.set.completedAt ?? endedAt).getTime()) ||
        (value === best.value &&
          (set.completedAt ?? endedAt).getTime() ===
            (best.set.completedAt ?? endedAt).getTime() &&
          set.id.localeCompare(best.set.id) < 0)
      ) {
        bestCurrent.set(key, { set, kind, value });
      }
    }
  }

  const historicalFrontiers = new Map(
    [...historicalByExercise].map(([exerciseId, sets]) => [
      exerciseId,
      recordFrontier(sets),
    ]),
  );

  return [...bestCurrent.values()]
    .flatMap(({ set, kind, value }) => {
      const previousBest =
        historicalFrontiers.get(set.exerciseId)?.[kind] ?? null;
      if (previousBest !== null && value <= previousBest) return [];
      return [
        {
          kind,
          exerciseId: set.exerciseId,
          exerciseName: set.exerciseName,
          value,
          ...(previousBest === null ? {} : { previousBest }),
          setNumber: set.setNumber,
          achievedAt: (set.completedAt ?? endedAt).toISOString(),
        },
      ];
    })
    .sort(
      (a, b) =>
        a.exerciseName.localeCompare(b.exerciseName) ||
        RECORD_KINDS.indexOf(a.kind) - RECORD_KINDS.indexOf(b.kind) ||
        a.setNumber - b.setNumber,
    );
}
