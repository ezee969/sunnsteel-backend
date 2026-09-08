import type {
  EarnedPersonalRecord,
  PersonalRecordKind,
} from '@sunsteel/contracts';

export interface RecordSet {
  reps: number | null;
  weight: number | null;
  isCompleted: boolean;
}

export interface RecordFrontier {
  WEIGHT: number | null;
  REPS: number | null;
  VOLUME: number | null;
  ESTIMATED_1RM: number | null;
}

const KINDS: PersonalRecordKind[] = [
  'WEIGHT',
  'REPS',
  'VOLUME',
  'ESTIMATED_1RM',
];

const round = (value: number, precision: number) => {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export function recordValues(set: RecordSet): RecordFrontier {
  const reps = set.reps ?? 0;
  const weight = set.weight ?? 0;
  if (!set.isCompleted || reps <= 0) {
    return {
      WEIGHT: null,
      REPS: null,
      VOLUME: null,
      ESTIMATED_1RM: null,
    };
  }
  return {
    WEIGHT: weight > 0 ? weight : null,
    REPS: reps,
    VOLUME: weight > 0 ? round(weight * reps, 2) : null,
    ESTIMATED_1RM: weight > 0 ? round(weight * (1 + reps / 30), 1) : null,
  };
}

export function recordFrontier(sets: RecordSet[]): RecordFrontier {
  const frontier: RecordFrontier = {
    WEIGHT: null,
    REPS: null,
    VOLUME: null,
    ESTIMATED_1RM: null,
  };
  for (const set of sets) {
    const values = recordValues(set);
    for (const kind of KINDS) {
      const value = values[kind];
      if (
        value !== null &&
        (frontier[kind] === null || value > frontier[kind]!)
      )
        frontier[kind] = value;
    }
  }
  return frontier;
}

export function earnedPersonalRecords(input: {
  candidate: RecordSet;
  existing: RecordSet | null;
  previous: RecordFrontier;
  exerciseId: string;
  exerciseName: string;
}): EarnedPersonalRecord[] {
  const candidate = recordValues(input.candidate);
  const existing = input.existing ? recordValues(input.existing) : null;
  const earned: EarnedPersonalRecord[] = [];

  for (const kind of KINDS) {
    const value = candidate[kind];
    if (value === null) continue;
    const previousValues = [
      input.previous[kind],
      existing?.[kind] ?? null,
    ].filter((entry): entry is number => entry !== null);
    const previousBest = previousValues.length
      ? Math.max(...previousValues)
      : null;
    if (previousBest !== null && value <= previousBest) continue;
    earned.push({
      kind,
      exerciseId: input.exerciseId,
      exerciseName: input.exerciseName,
      value,
      ...(previousBest === null ? {} : { previousBest }),
    });
  }
  return earned;
}
