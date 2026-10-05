import { Prisma } from "@prisma/client";
import {
  advanceLinearPeriodization,
  type LinearBlockChange,
  type LinearPeriodizationState,
  lpStoredSets,
  sameLpPosition,
  setKindOf,
} from "@sunsteel/contracts";

import {
  linearStateJson,
  readLinearState,
} from "../routines/linear-periodization";
import { linearLoggedSets, linearSlotOf } from "./session-linear-block";

// ROUT-17/ROUT-18: what a completed workout does to its LP slots. The step
// it trained comes from the snapshot; the routine row moves only while it
// still stands where the workout started, so an edit, a restart or a choice
// made since is never overwritten by an older workout.

export type LinearBlockLog = {
  routineExerciseId: string;
  setNumber: number;
  reps: number | null;
  isCompleted: boolean;
};

/**
 * The block each LP slot of the workout reaches, compared with where it
 * started -- pure, so the finish and a LIVE-17 correction share it. Swapped
 * slots never move; `runs` is false for a deload session.
 */
export function plannedLinearChanges(
  snapshotPayload: unknown,
  slots: ReadonlyArray<{
    id: string;
    minWeightIncrement?: number;
    exercise: { id: string; name: string };
  }>,
  logs: readonly LinearBlockLog[],
  context: {
    sessionId: string;
    finishedAt: string;
    runs: boolean;
    substitutedIds: ReadonlySet<string>;
  },
): LinearBlockChange[] {
  if (!context.runs) return [];
  const changes: LinearBlockChange[] = [];
  for (const exercise of slots) {
    if (context.substitutedIds.has(exercise.id)) continue;
    const slot = linearSlotOf(snapshotPayload, exercise.id);
    if (!slot) continue;
    const after = advanceLinearPeriodization(
      slot.state,
      linearLoggedSets(
        slot,
        logs.filter((log) => log.routineExerciseId === exercise.id),
      ),
      {
        sessionId: context.sessionId,
        finishedAt: context.finishedAt,
        incrementKg: slot.minWeightIncrement,
      },
    );
    if (!after) continue;
    changes.push({
      routineExerciseId: exercise.id,
      exerciseId: exercise.exercise.id,
      exerciseName: exercise.exercise.name,
      minWeightIncrementKg: slot.minWeightIncrement,
      before: slot.state,
      after,
    });
  }
  return changes;
}

/** A finished block: step 8 was just done. */
export const finishedBlock = (change: LinearBlockChange) =>
  change.before.phase === "BLOCK" && change.after.phase === "FINISHED";

export const linearBlockSourceKey = (
  sessionId: string,
  routineExerciseId: string,
) => `linear-block:${sessionId}:${routineExerciseId}`;

/**
 * Moves a slot from `from` to `to` on the routine: its state and the working
 * sets `to` prescribes, after its warm-ups. Returns false, writing nothing,
 * when the row is gone or no longer stands at `from`.
 */
export async function moveLinearSlot(
  tx: Prisma.TransactionClient,
  routineExerciseId: string,
  from: LinearPeriodizationState,
  to: LinearPeriodizationState,
): Promise<boolean> {
  const live = await tx.routineExercise.findUnique({
    where: { id: routineExerciseId },
    select: {
      progressionScheme: true,
      minWeightIncrement: true,
      linearPeriodization: true,
      sets: { select: { setNumber: true, kind: true } },
    },
  });
  if (
    !live ||
    live.progressionScheme !== "LINEAR_PERIODIZATION" ||
    !sameLpPosition(readLinearState(live.linearPeriodization), from)
  ) {
    return false;
  }
  await writeLinearSlot(tx, routineExerciseId, live, to);
  return true;
}

/** Stores a state and the working sets it prescribes, warm-ups kept. */
export async function writeLinearSlot(
  tx: Prisma.TransactionClient,
  routineExerciseId: string,
  live: {
    minWeightIncrement: number;
    sets: Array<{ setNumber: number; kind: string }>;
  },
  state: LinearPeriodizationState,
) {
  const warmUps = live.sets.filter(
    (set) => setKindOf({ kind: set.kind as never }) === "WARMUP",
  );
  const after = warmUps.reduce((max, set) => Math.max(max, set.setNumber), 0);
  await tx.routineExerciseSet.deleteMany({
    where: { routineExerciseId, kind: { not: "WARMUP" } },
  });
  await tx.routineExerciseSet.createMany({
    data: lpStoredSets(state, live.minWeightIncrement).map((set, index) => ({
      routineExerciseId,
      setNumber: after + index + 1,
      repType: set.repType,
      reps: set.reps,
      weight: set.weight,
      rir: set.rir,
      kind: set.kind,
    })),
  });
  await tx.routineExercise.update({
    where: { id: routineExerciseId },
    data: { linearPeriodization: linearStateJson(state) },
    select: { id: true },
  });
}

/** The ROUT-18 notification for a finished block, written once. */
export async function notifyFinishedBlock(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    sessionId: string;
    routineId: string;
    routineName: string;
    change: LinearBlockChange;
    at: Date;
  },
) {
  const payload = {
    routineId: input.routineId,
    routineName: input.routineName,
    exerciseId: input.change.exerciseId,
    exerciseName: input.change.exerciseName,
    referenceMaxKg: input.change.after.referenceMaxKg,
    estimatedMaxKg: input.change.after.estimatedMaxKg ?? null,
  };
  await tx.notification.upsert({
    where: {
      userId_sourceKey: {
        userId: input.userId,
        sourceKey: linearBlockSourceKey(
          input.sessionId,
          input.change.routineExerciseId,
        ),
      },
    },
    create: {
      userId: input.userId,
      kind: "LINEAR_BLOCK_FINISHED",
      sourceKey: linearBlockSourceKey(
        input.sessionId,
        input.change.routineExerciseId,
      ),
      sessionId: input.sessionId,
      payload,
      createdAt: input.at,
    },
    update: { payload },
  });
}

/** The changes a session stored, read back tolerantly. */
export function readLinearBlockChanges(value: unknown): LinearBlockChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const change = entry as Record<string, unknown>;
    const before = readLinearState(change.before);
    const after = readLinearState(change.after);
    if (
      !before ||
      !after ||
      typeof change.routineExerciseId !== "string" ||
      typeof change.exerciseId !== "string"
    ) {
      return [];
    }
    return [
      {
        routineExerciseId: change.routineExerciseId,
        exerciseId: change.exerciseId,
        exerciseName: String(change.exerciseName ?? ""),
        minWeightIncrementKg: Number(change.minWeightIncrementKg) || 2.5,
        before,
        after,
      },
    ];
  });
}

export const linearBlockChangesJson = (changes: LinearBlockChange[]) =>
  changes as unknown as Prisma.InputJsonValue;
