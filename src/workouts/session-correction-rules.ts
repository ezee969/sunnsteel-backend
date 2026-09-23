import { BadRequestException } from '@nestjs/common';
import {
  type CorrectSessionSetRequest,
  SESSION_CORRECTION_LIMITS,
  type SessionSetCorrection,
  type SetLogValues,
  setLogValuesDiffer,
} from '@sunsteel/contracts';
import type { AnalyticsLog } from './analytics/analytics-contribution';
import type { ProgressionUpdate } from './progression-changes';

/**
 * LIVE-17 rules, pure so each one is tested on its own. The service applies
 * them inside the account lock; nothing here reads or writes the database.
 */

export interface CorrectableLog extends AnalyticsLog {
  setNumber: number;
  rpe: number | null;
}

const valuesOf = (log: CorrectableLog): SetLogValues => ({
  weight: log.weight,
  reps: log.reps,
  rpe: log.rpe,
  isCompleted: log.isCompleted,
});

function assertValues(values: SetLogValues) {
  const { weightKgMax, repsMax, rpeMin, rpeMax } = SESSION_CORRECTION_LIMITS;
  if (
    values.weight !== null &&
    (!Number.isFinite(values.weight) ||
      values.weight < 0 ||
      values.weight > weightKgMax)
  )
    throw new BadRequestException(
      `Weight must be between 0 and ${weightKgMax} kg`,
    );
  if (
    values.reps !== null &&
    (!Number.isInteger(values.reps) || values.reps < 0 || values.reps > repsMax)
  )
    throw new BadRequestException(
      `Reps must be a whole number between 0 and ${repsMax}`,
    );
  if (
    values.rpe !== null &&
    (!Number.isFinite(values.rpe) || values.rpe < rpeMin || values.rpe > rpeMax)
  )
    throw new BadRequestException(`RPE must be between ${rpeMin} and ${rpeMax}`);
  if (values.isCompleted && (values.reps === null || values.reps < 1))
    throw new BadRequestException('A completed set needs at least one rep');
}

/**
 * The changes a request makes to this workout's own logs. Unknown or repeated
 * set ids are refused; sets whose values do not change are ignored; a request
 * that changes nothing is refused, because an empty correction would add a
 * line to the trail that records no correction.
 */
export function planSetCorrections(
  logs: CorrectableLog[],
  requested: CorrectSessionSetRequest[],
  exerciseNames: Map<string, string>,
): SessionSetCorrection[] {
  const byId = new Map(logs.map((log) => [log.id, log]));
  const seen = new Set<string>();
  const changes: SessionSetCorrection[] = [];
  for (const set of requested) {
    const log = byId.get(set.setLogId);
    if (!log)
      throw new BadRequestException('Set does not belong to this workout');
    if (seen.has(set.setLogId))
      throw new BadRequestException('Each set can be corrected once per request');
    seen.add(set.setLogId);
    // An omitted value is an empty one, never "leave it as it was": the
    // request states how each set should read.
    const after: SetLogValues = {
      weight: set.weight ?? null,
      reps: set.reps ?? null,
      rpe: set.rpe ?? null,
      isCompleted: set.isCompleted,
    };
    const before = valuesOf(log);
    if (!setLogValuesDiffer(before, after)) continue;
    assertValues(after);
    changes.push({
      setLogId: log.id,
      exerciseId: log.exerciseId,
      exerciseName: exerciseNames.get(log.exerciseId) ?? 'Exercise',
      setNumber: log.setNumber,
      before,
      after,
    });
  }
  if (changes.length === 0)
    throw new BadRequestException('Nothing to correct: every set already reads that way');
  return changes;
}

/**
 * The logs as they read after the correction. A set newly ticked takes the
 * workout's end as its completion time, since the moment it was really done
 * was never recorded; a set unticked loses its completion time.
 */
export function applySetCorrections<T extends CorrectableLog>(
  logs: T[],
  changes: SessionSetCorrection[],
  endedAt: Date,
): T[] {
  const byId = new Map(changes.map((change) => [change.setLogId, change]));
  const corrected = logs.map((log) => {
    const change = byId.get(log.id);
    if (!change) return log;
    const { after } = change;
    return {
      ...log,
      weight: after.weight,
      reps: after.reps,
      rpe: after.rpe,
      isCompleted: after.isCompleted,
      completedAt: after.isCompleted ? (log.completedAt ?? endedAt) : null,
    };
  });
  if (!corrected.some((log) => log.isCompleted))
    throw new BadRequestException(
      'A finished workout keeps at least one completed set',
    );
  return corrected;
}

export interface RecordSet {
  weight: number;
  reps: number;
}

/**
 * The record frontier's own comparison: heavier wins, then more reps at the
 * same weight. A tie is not a new record.
 */
export const beatsRecord = (candidate: RecordSet, prior: RecordSet | null) =>
  !prior ||
  candidate.weight > prior.weight ||
  (candidate.weight === prior.weight && candidate.reps > prior.reps);

/**
 * Whether this workout's load change for one routine exercise can be
 * re-derived. At finish every logged weight was written back to the routine
 * (and raised where a target was met); if the routine's sets still read
 * exactly that, nothing has touched them since and they can be rewritten. If
 * anything differs -- a routine edit, a restored version -- re-deriving would
 * undo the owner's own change, so the load change is kept.
 */
export function prescriptionIntact(
  snapshotSets: Array<{ setNumber: number; weight?: number | null }>,
  current: Array<{ setNumber: number; weight: number | null }>,
  finishUpdates: ProgressionUpdate[],
): boolean {
  if (current.length !== snapshotSets.length) return false;
  const now = new Map(current.map((set) => [set.setNumber, set.weight]));
  const written = new Map(
    finishUpdates.map((update) => [update.setNumber, update.newWeight]),
  );
  return snapshotSets.every((set) => {
    if (!now.has(set.setNumber)) return false;
    const expected = written.has(set.setNumber)
      ? written.get(set.setNumber)!
      : (set.weight ?? null);
    const actual = now.get(set.setNumber) ?? null;
    if (expected === null || actual === null) return expected === actual;
    return Math.abs(expected - actual) < 1e-9;
  });
}

/** The weights the routine's sets should hold after the correction. */
export function correctedPrescription(
  snapshotSets: Array<{ setNumber: number; weight?: number | null }>,
  correctedUpdates: ProgressionUpdate[],
): Array<{ setNumber: number; weight: number | null }> {
  const written = new Map(
    correctedUpdates.map((update) => [update.setNumber, update.newWeight]),
  );
  return snapshotSets.map((set) => ({
    setNumber: set.setNumber,
    weight: written.has(set.setNumber)
      ? written.get(set.setNumber)!
      : (set.weight ?? null),
  }));
}

/** How the contribution of one workout changed, for the rollups it feeds. */
export function contributionDelta(
  before: {
    volumeKg: number;
    completedSets: number;
    muscles: Array<[string, { volumeKg: number; completedSets: number }]>;
  },
  after: typeof before,
) {
  const muscles = new Map<string, { volumeKg: number; completedSets: number }>();
  for (const [muscle, values] of after.muscles)
    muscles.set(muscle, { ...values });
  for (const [muscle, values] of before.muscles) {
    const current = muscles.get(muscle) ?? { volumeKg: 0, completedSets: 0 };
    muscles.set(muscle, {
      volumeKg: current.volumeKg - values.volumeKg,
      completedSets: current.completedSets - values.completedSets,
    });
  }
  return {
    volumeKg: after.volumeKg - before.volumeKg,
    completedSets: after.completedSets - before.completedSets,
    muscles: [...muscles]
      .filter(([, values]) => values.volumeKg !== 0 || values.completedSets !== 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  };
}
