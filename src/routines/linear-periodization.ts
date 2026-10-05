import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  LP_BLOCK_STEPS,
  LP_ESTIMATE_STEPS,
  LP_PHASES,
  LP_WORKING_SETS,
  type LinearPeriodizationState,
  type LpPhase,
  type LpSample,
  type SetKind,
  apiError,
  linearPeriodizationProblem,
  lpStoredSets,
} from "@sunsteel/contracts";

// ROUT-17: an exercise on the LINEAR_PERIODIZATION scheme keeps where its slot
// is in the 8-step block as JSON on the RoutineExercise row. Every edit
// recreates those rows, so the state travels in the request and in every
// setup the way set loads do; this module reads it back and keeps the
// stored working sets equal to what the state prescribes.

export const LINEAR_PERIODIZATION = "LINEAR_PERIODIZATION" as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Samples worth keeping: steps 7-8, sets 1-3, whole reps. */
function readSamples(value: unknown): LpSample[] {
  if (!Array.isArray(value)) return [];
  const samples: LpSample[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const step = finite(entry.step);
    const set = finite(entry.set);
    const loadKg = finite(entry.loadKg);
    const reps = finite(entry.reps);
    if (
      step === null ||
      !LP_ESTIMATE_STEPS.includes(step) ||
      set === null ||
      !Number.isInteger(set) ||
      set < 1 ||
      set > LP_WORKING_SETS ||
      loadKg === null ||
      loadKg < 0 ||
      reps === null ||
      !Number.isInteger(reps) ||
      reps < 0 ||
      reps > 100
    ) {
      continue;
    }
    samples.push({
      sessionId: typeof entry.sessionId === "string" ? entry.sessionId : "",
      step,
      set,
      loadKg,
      reps,
    });
  }
  return samples.slice(0, LP_ESTIMATE_STEPS.length * LP_WORKING_SETS);
}

/**
 * A stored or requested state, or null when there is none. Anything that is
 * not a state at all reads as null; `assertLinearState` is the strict check
 * for a write.
 */
export function readLinearState(
  value: unknown,
): LinearPeriodizationState | null {
  if (!isRecord(value)) return null;
  const referenceMaxKg = finite(value.referenceMaxKg);
  const step = finite(value.step);
  const cycle = finite(value.cycle);
  if (referenceMaxKg === null || step === null || cycle === null) return null;
  const phase = (LP_PHASES as readonly unknown[]).includes(value.phase)
    ? (value.phase as LpPhase)
    : null;
  if (!phase) return null;
  return {
    referenceMaxKg,
    phase,
    step,
    cycle,
    samples: readSamples(value.samples),
    finishedAt:
      typeof value.finishedAt === "string" ? value.finishedAt : null,
    estimatedMaxKg: finite(value.estimatedMaxKg),
    nextReferenceMaxKg: finite(value.nextReferenceMaxKg),
  };
}

/** A requested state, refused with its reason when it cannot be stored. */
export function assertLinearState(value: unknown): LinearPeriodizationState {
  const state = readLinearState(value);
  const problem = state
    ? linearPeriodizationProblem(state)
    : "The block's state is not readable";
  if (!state || problem) {
    throw new BadRequestException(
      apiError("LINEAR_BLOCK_INVALID", { reason: problem ?? "" }),
    );
  }
  return {
    ...state,
    step: Math.min(Math.max(state.step, 1), LP_BLOCK_STEPS),
  };
}

/** The value Prisma stores: the state, or SQL NULL. */
export function linearStateJson(
  state: LinearPeriodizationState | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return state
    ? (state as unknown as Prisma.InputJsonValue)
    : Prisma.DbNull;
}

/**
 * The sets an LP exercise is stored with: its warm-ups as written, first,
 * then the working sets its state prescribes (`lpStoredSets`), renumbered.
 * Without a state (a clone, before its owner sets a reference max) the
 * working sets carry no load.
 */
export function linearExerciseSets<
  S extends { setNumber: number; kind?: SetKind | null },
>(
  sets: readonly S[],
  state: LinearPeriodizationState | null,
  incrementKg: number,
): Array<
  | S
  | {
      setNumber: number;
      repType: "FIXED";
      reps: number | null;
      weight: number | null;
      rir: number | null;
      kind: "WORKING";
    }
> {
  const warmUps = sets.filter((set) => (set.kind ?? "WORKING") === "WARMUP");
  const working = lpStoredSets(state, incrementKg);
  if (warmUps.length + working.length > 10) {
    throw new BadRequestException(
      "An exercise on an 8-week block has room for at most 7 warm-up sets",
    );
  }
  return [
    ...warmUps.map((set, index) => ({ ...set, setNumber: index + 1 })),
    ...working.map((set, index) => ({
      ...set,
      setNumber: warmUps.length + index + 1,
    })),
  ];
}

/**
 * What an exercise of a routine write stores for the block: an LP exercise
 * its validated state (or none) and its normalized sets; any other scheme no
 * state and the sets it was sent.
 */
export function normalizeLinearExercise<
  S extends { setNumber: number; kind?: SetKind | null },
>(exercise: {
  progressionScheme?: string | null;
  minWeightIncrement?: number | null;
  linearPeriodization?: unknown;
  sets: readonly S[];
}) {
  if (exercise.progressionScheme !== LINEAR_PERIODIZATION) {
    return { linearPeriodization: null, sets: [...exercise.sets], linear: false };
  }
  const state =
    exercise.linearPeriodization == null
      ? null
      : assertLinearState(exercise.linearPeriodization);
  return {
    linearPeriodization: state,
    sets: linearExerciseSets(
      exercise.sets,
      state,
      exercise.minWeightIncrement ?? 2.5,
    ),
    linear: true,
  };
}

/**
 * A setup as another member may read it (ROUT-04/ROUT-05): an LP exercise
 * keeps its scheme and the shape of its sets but not the owner's block -- no
 * state and no loads, since every load of the slot is a share of the owner's
 * reference max. Anything else is untouched.
 */
export function withoutOwnersBlocks<
  T extends {
    days: Array<{
      exercises: Array<{
        progressionScheme: string;
        linearPeriodization?: unknown;
        sets: Array<{ weight?: number | null }>;
      }>;
    }>;
  },
>(setup: T): T {
  return {
    ...setup,
    days: setup.days.map((day) => ({
      ...day,
      exercises: day.exercises.map((exercise) =>
        exercise.progressionScheme === LINEAR_PERIODIZATION
          ? {
              ...exercise,
              linearPeriodization: null,
              sets: exercise.sets.map((set) => ({ ...set, weight: null })),
            }
          : exercise,
      ),
    })),
  };
}
