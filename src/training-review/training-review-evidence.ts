import {
  countsForProgression,
  type SetKind,
  type TrainingReviewFact,
  type TrainingReviewFactKind,
  type TrainingReviewQuestion,
  type TrainingReviewWorkout,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import { readSnapshot } from "../workouts/analytics/session-snapshot";
import { COUNTED_SET_LOG } from "../workouts/counted-sets";
import { recordValues } from "../workouts/live-personal-records";
import { repTargetFloors } from "../workouts/workout-training-signals.service";
import { routineDayName } from "../workouts/workout-session.selects";

/**
 * INTEL-04: the evidence pack. Every value a review can show is a numbered
 * fact computed here from the workouts the member picked, and nothing else:
 * their completed sets (warm-ups never), the rep targets their snapshots
 * recorded and the records they set. The model only ever points at these
 * facts, so a number it did not read here cannot reach the screen.
 */

export interface ReviewWorkoutRow {
  sessionId: string;
  routineName: string;
  dayName: string | null;
  endedAt: Date;
  durationSec: number | null;
  /** Rep-target floors from the workout's snapshot, keyed `slotId:setNumber`. */
  floors: ReadonlyMap<string, number>;
}

/** One completed set that counts as work. */
export interface ReviewSetRow {
  sessionId: string;
  exerciseId: string;
  exerciseName: string;
  slotId: string | null;
  setNumber: number;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
  kind: SetKind | null;
}

/** A `PERSONAL_RECORD` event of one of the workouts: a new best set. */
export interface ReviewRecordRow {
  sessionId: string;
  exerciseId: string;
  weight: number;
  reps: number;
}

/** Why a question cannot be asked of these workouts, decided before any call. */
export type ReviewPrecheck = "NO_SHARED_EXERCISE" | "NO_EFFORT_DATA" | null;

export interface EvidencePack {
  question: TrainingReviewQuestion;
  /** Oldest first, as `W1`, `W2`... in the prompt. */
  workouts: TrainingReviewWorkout[];
  facts: TrainingReviewFact[];
  /** What the model reads, one line per fact. */
  lines: string[];
  precheck: ReviewPrecheck;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** A name inside a pipe-separated line, so it cannot start a line of its own. */
const clean = (name: string) =>
  name
    .replace(/[\r\n|<>]+/g, " ")
    .trim()
    .slice(0, 80);

function describe(fact: TrainingReviewFact): string {
  const kg = (value: number | null) => `${round1(value ?? 0)} kg`;
  const set = () =>
    (fact.value ?? 0) > 0
      ? `${kg(fact.value)} x ${fact.reps}`
      : `${fact.reps} reps, bodyweight`;
  switch (fact.kind) {
    case "EXERCISE":
      return "the exercise";
    case "WORKOUT":
      return "the workout";
    case "DURATION":
      return `lasted ${Math.round((fact.value ?? 0) / 60)} min`;
    case "VOLUME":
      return `volume ${kg(fact.value)}`;
    case "SETS":
      return `completed sets ${fact.value}`;
    case "BEST_SET":
      return `best set ${set()}`;
    case "ESTIMATED_1RM":
      return `best estimated 1RM ${kg(fact.value)}`;
    case "AVERAGE_RPE":
      return `average RPE ${fact.value}`;
    case "TARGETED_SETS":
      return `sets with a rep target ${fact.value}`;
    case "SETS_BELOW_TARGET":
      return `sets short of their rep target ${fact.value}`;
    case "RECORD":
      return `new personal best set ${set()}`;
  }
}

/** The heaviest completed set, then the most reps; a bodyweight best by reps. */
function bestSet(
  sets: readonly ReviewSetRow[],
): { weight: number; reps: number } | null {
  let best: { weight: number; reps: number } | null = null;
  for (const set of sets) {
    const reps = set.reps ?? 0;
    if (reps <= 0) continue;
    const weight = set.weight ?? 0;
    if (
      !best ||
      weight > best.weight ||
      (weight === best.weight && reps > best.reps)
    ) {
      best = { weight, reps };
    }
  }
  return best;
}

/**
 * Builds the facts a question needs, oldest workout first. What changed reads
 * duration, volume and sets; progress reads the best sets, estimated maxes and
 * records of the exercises trained in more than one workout; effort reads RPE
 * and rep targets. Pure, so every fact is tested without a database.
 */
export function buildEvidencePack(input: {
  question: TrainingReviewQuestion;
  workouts: readonly ReviewWorkoutRow[];
  sets: readonly ReviewSetRow[];
  records: readonly ReviewRecordRow[];
}): EvidencePack {
  const { question } = input;
  const workouts = [...input.workouts].sort(
    (a, b) =>
      a.endedAt.getTime() - b.endedAt.getTime() ||
      a.sessionId.localeCompare(b.sessionId),
  );
  const refOf = new Map(
    workouts.map((workout, index) => [workout.sessionId, `W${index + 1}`]),
  );

  // Each workout's exercises in the order they were done, and where each appears.
  const byWorkout = new Map<string, Map<string, ReviewSetRow[]>>();
  const names = new Map<string, string>();
  const appearsIn = new Map<string, Set<string>>();
  for (const set of input.sets) {
    if (!refOf.has(set.sessionId)) continue;
    const exercises =
      byWorkout.get(set.sessionId) ?? new Map<string, ReviewSetRow[]>();
    byWorkout.set(set.sessionId, exercises);
    exercises.set(set.exerciseId, [
      ...(exercises.get(set.exerciseId) ?? []),
      set,
    ]);
    names.set(set.exerciseId, set.exerciseName);
    appearsIn.set(
      set.exerciseId,
      (appearsIn.get(set.exerciseId) ?? new Set()).add(set.sessionId),
    );
  }
  const shared = new Set(
    [...appearsIn]
      .filter(([, sessions]) => sessions.size >= 2)
      .map(([exerciseId]) => exerciseId),
  );
  const included = (exerciseId: string) =>
    question !== "PROGRESS" || shared.has(exerciseId);

  const facts: TrainingReviewFact[] = [];
  const add = (
    kind: TrainingReviewFactKind,
    sessionId: string | null,
    exerciseId: string | null,
    value: number | null,
    reps: number | null = null,
  ) => {
    facts.push({
      id: `F${facts.length + 1}`,
      kind,
      sessionId,
      exerciseId,
      exerciseName: exerciseId ? (names.get(exerciseId) ?? null) : null,
      value,
      reps,
    });
  };

  for (const exerciseId of names.keys()) {
    if (included(exerciseId)) add("EXERCISE", null, exerciseId, null);
  }

  let targeted = 0;
  let rated = 0;
  for (const workout of workouts) {
    const id = workout.sessionId;
    const exercises = byWorkout.get(id) ?? new Map<string, ReviewSetRow[]>();
    const all = [...exercises.values()].flat();
    add("WORKOUT", id, null, null);
    if (question === "CHANGES") {
      if (workout.durationSec) add("DURATION", id, null, workout.durationSec);
      const volume = all.reduce(
        (sum, set) => sum + (set.weight ?? 0) * (set.reps ?? 0),
        0,
      );
      if (volume > 0) add("VOLUME", id, null, round1(volume));
    }
    add("SETS", id, null, all.length);

    for (const [exerciseId, sets] of exercises) {
      if (!included(exerciseId)) continue;
      add("SETS", id, exerciseId, sets.length);
      const best = bestSet(sets);
      if (question === "CHANGES") {
        const volume = sets.reduce(
          (sum, set) => sum + (set.weight ?? 0) * (set.reps ?? 0),
          0,
        );
        if (volume > 0) add("VOLUME", id, exerciseId, round1(volume));
        if (best) add("BEST_SET", id, exerciseId, best.weight, best.reps);
      }
      if (question === "PROGRESS") {
        if (best) add("BEST_SET", id, exerciseId, best.weight, best.reps);
        const estimates = sets
          .map(
            (set) =>
              recordValues({
                isCompleted: true,
                weight: set.weight,
                reps: set.reps,
                kind: set.kind,
              }).ESTIMATED_1RM,
          )
          .filter((value): value is number => value !== null);
        if (estimates.length)
          add("ESTIMATED_1RM", id, exerciseId, Math.max(...estimates));
        for (const record of input.records) {
          if (record.sessionId === id && record.exerciseId === exerciseId) {
            add("RECORD", id, exerciseId, record.weight, record.reps);
          }
        }
      }
      if (question === "EFFORT") {
        const ratings = sets
          .map((set) => set.rpe)
          .filter((rpe): rpe is number => rpe !== null);
        if (ratings.length) {
          rated += ratings.length;
          add(
            "AVERAGE_RPE",
            id,
            exerciseId,
            round1(ratings.reduce((a, b) => a + b, 0) / ratings.length),
          );
        }
        let withTarget = 0;
        let below = 0;
        for (const set of sets) {
          if (
            !countsForProgression(set.kind) ||
            set.slotId === null ||
            set.reps === null
          )
            continue;
          const floor = workout.floors.get(`${set.slotId}:${set.setNumber}`);
          if (floor === undefined) continue;
          withTarget += 1;
          if (set.reps < floor) below += 1;
        }
        if (withTarget) {
          targeted += withTarget;
          add("TARGETED_SETS", id, exerciseId, withTarget);
          add("SETS_BELOW_TARGET", id, exerciseId, below);
        }
      }
    }
  }

  const lines = facts.map((fact) => {
    const where = fact.sessionId ? refOf.get(fact.sessionId) : "-";
    const what = fact.exerciseId
      ? clean(fact.exerciseName ?? "")
      : "whole workout";
    return `${fact.id} | ${where} | ${what} | ${describe(fact)}`;
  });

  const precheck: ReviewPrecheck =
    question === "EFFORT"
      ? targeted + rated === 0
        ? "NO_EFFORT_DATA"
        : null
      : shared.size === 0
        ? "NO_SHARED_EXERCISE"
        : null;

  return {
    question,
    workouts: workouts.map((workout) => ({
      sessionId: workout.sessionId,
      routineName: workout.routineName,
      dayName: workout.dayName,
      endedAt: workout.endedAt.toISOString(),
    })),
    facts,
    lines,
    precheck,
  };
}

/**
 * The member's own finished workouts with at least one completed set, or
 * null when any id is not one of them -- another member's, still running,
 * discarded or empty -- so a review never reads what the member did not pick.
 */
export async function readReviewEvidence(
  db: Pick<DatabaseService, "workoutSession" | "setLog" | "trainingEvent">,
  userId: string,
  sessionIds: readonly string[],
): Promise<{
  workouts: ReviewWorkoutRow[];
  sets: ReviewSetRow[];
  records: ReviewRecordRow[];
} | null> {
  const sessions = await db.workoutSession.findMany({
    where: {
      id: { in: [...sessionIds] },
      userId,
      status: { in: ["COMPLETED", "ABORTED"] },
      endedAt: { not: null },
    },
    select: {
      id: true,
      endedAt: true,
      durationSec: true,
      snapshot: { select: { payload: true } },
      routine: { select: { name: true } },
      routineDay: { select: { dayOfWeek: true, name: true, order: true } },
    },
  });
  if (sessions.length !== sessionIds.length) return null;

  const logs = await db.setLog.findMany({
    where: { sessionId: { in: [...sessionIds] }, ...COUNTED_SET_LOG },
    select: {
      sessionId: true,
      exerciseId: true,
      sourceRoutineExerciseId: true,
      routineExerciseId: true,
      setNumber: true,
      reps: true,
      weight: true,
      rpe: true,
      kind: true,
      exercise: { select: { name: true } },
    },
    orderBy: [{ completedAt: "asc" }, { id: "asc" }],
  });
  const worked = new Set(logs.map((log) => log.sessionId));
  if (sessionIds.some((id) => !worked.has(id))) return null;

  const events = await db.trainingEvent.findMany({
    where: {
      userId,
      type: "PERSONAL_RECORD",
      sessionId: { in: [...sessionIds] },
    },
    select: { sessionId: true, payload: true },
  });

  return {
    workouts: sessions.map((session) => {
      let snapshot: ReturnType<typeof readSnapshot> | null = null;
      try {
        snapshot = session.snapshot
          ? readSnapshot(session.snapshot.payload)
          : null;
      } catch {
        snapshot = null;
      }
      return {
        sessionId: session.id,
        routineName:
          snapshot?.routine.name ?? session.routine?.name ?? "Workout",
        dayName: routineDayName(snapshot?.routineDay ?? session.routineDay),
        endedAt: session.endedAt!,
        durationSec: session.durationSec,
        floors: snapshot
          ? repTargetFloors(snapshot)
          : new Map<string, number>(),
      };
    }),
    sets: logs.map((log) => ({
      sessionId: log.sessionId,
      exerciseId: log.exerciseId,
      exerciseName: log.exercise.name,
      slotId: log.sourceRoutineExerciseId ?? log.routineExerciseId,
      setNumber: log.setNumber,
      reps: log.reps,
      weight: log.weight,
      rpe: log.rpe,
      kind: log.kind,
    })),
    records: events.flatMap((event) => {
      const payload = event.payload as {
        exerciseId?: unknown;
        weight?: unknown;
        reps?: unknown;
      } | null;
      if (
        !event.sessionId ||
        typeof payload?.exerciseId !== "string" ||
        typeof payload.weight !== "number" ||
        typeof payload.reps !== "number"
      ) {
        return [];
      }
      return [
        {
          sessionId: event.sessionId,
          exerciseId: payload.exerciseId,
          weight: payload.weight,
          reps: payload.reps,
        },
      ];
    }),
  };
}
