import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  apiError,
  canLogWorkoutOn,
  type LinearPeriodizationState,
  LOGGED_WORKOUT_DEFAULT_START_MINUTE,
  LOGGED_WORKOUT_LOOKBACK_DAYS,
  LOGGED_WORKOUT_MAX_DURATION_SEC,
  LOGGED_WORKOUT_MIN_DURATION_SEC,
  type LoggedBlockStep,
  type LoggedSetInput,
  lpAtStep,
  lpStoredSets,
  type SetKind,
} from "@sunsteel/contracts";

import { localClock } from "../notifications/push/local-time";
import { dayDifference } from "./analytics/analytics-contribution";
import { assertValues } from "./session-correction-rules";
import { MAX_EXTRA_SETS } from "./session-extra-sets";

// LIVE-23: the rules for a workout logged after it happened, kept pure so the
// service only reads and writes. Nothing here moves the routine.

/**
 * The instant a local date and minute name in a zone. A logged workout has no
 * clock to read forwards, so this is the one place the app maps a local time
 * back: on a daylight-saving change it lands on a neighbouring minute, which
 * is harmless for a workout that already happened.
 */
export function localTimeToInstant(
  date: string,
  minuteOfDay: number,
  timeZone: string,
): Date {
  let at = Date.parse(`${date}T00:00:00Z`) + minuteOfDay * 60_000;
  for (let pass = 0; pass < 3; pass += 1) {
    const clock = localClock(new Date(at), timeZone);
    const drift =
      dayDifference(clock.date, date) * 1440 + clock.minuteOfDay - minuteOfDay;
    if (drift === 0) break;
    at -= drift * 60_000;
  }
  return new Date(at);
}

export interface LoggedWorkoutTimes {
  startedAt: Date;
  endedAt: Date;
  durationSec: number;
  /** The local day the workout fell on, as instants: [from, to). */
  dayFrom: Date;
  dayTo: Date;
}

/**
 * When the logged workout happened, refused unless it falls on a date the
 * routine allows (before it was created, within the lookback) and ended
 * before the routine existed and before now.
 */
export function loggedWorkoutTimes(input: {
  date: string;
  startMinute?: number;
  durationSec?: number;
  estimateSec: number;
  timeZone: string;
  routineCreatedAt: Date;
  now: Date;
}): LoggedWorkoutTimes {
  const refuse = () =>
    new BadRequestException(
      apiError("LOGGED_WORKOUT_DATE", { days: LOGGED_WORKOUT_LOOKBACK_DAYS }),
    );
  const today = localClock(input.now, input.timeZone).date;
  const createdOn = localClock(input.routineCreatedAt, input.timeZone).date;
  if (!canLogWorkoutOn(input.date, { today, createdOn })) throw refuse();
  const minute = input.startMinute ?? LOGGED_WORKOUT_DEFAULT_START_MINUTE;
  const durationSec = Math.min(
    Math.max(
      Math.round(input.durationSec ?? input.estimateSec),
      LOGGED_WORKOUT_MIN_DURATION_SEC,
    ),
    LOGGED_WORKOUT_MAX_DURATION_SEC,
  );
  const startedAt = localTimeToInstant(input.date, minute, input.timeZone);
  const endedAt = new Date(startedAt.getTime() + durationSec * 1000);
  if (
    endedAt.getTime() >= input.routineCreatedAt.getTime() ||
    endedAt.getTime() > input.now.getTime()
  ) {
    throw refuse();
  }
  const next = new Date(`${input.date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    startedAt,
    endedAt,
    durationSec,
    dayFrom: localTimeToInstant(input.date, 0, input.timeZone),
    dayTo: localTimeToInstant(
      next.toISOString().slice(0, 10),
      0,
      input.timeZone,
    ),
  };
}

export interface LoggedDaySlot {
  id: string;
  exerciseId: string;
  progressionScheme: string;
  linearPeriodization: LinearPeriodizationState | null;
  sets: Array<{ setNumber: number; kind: SetKind | null }>;
}

export interface LoggedSetRow {
  routineExerciseId: string;
  exerciseId: string;
  setNumber: number;
  reps: number;
  weight: number;
  rpe: number | null;
  isCompleted: boolean;
  kind: SetKind;
}

const notInDay = () =>
  new BadRequestException(apiError("LOGGED_WORKOUT_SET_NOT_IN_DAY"));

/**
 * The set logs a logged workout stores: every set belongs to an exercise of
 * the day, once, within the prescription and the extra sets after it with no
 * gap, inside the correction bounds; at least one was done. A set takes its
 * prescription's kind unless it says otherwise; an extra set is working.
 */
export function loggedSetRows(
  slots: LoggedDaySlot[],
  sets: LoggedSetInput[],
): LoggedSetRow[] {
  const bySlot = new Map(slots.map((slot) => [slot.id, slot]));
  const seen = new Set<string>();
  const extras = new Map<string, number[]>();
  const rows: LoggedSetRow[] = [];
  for (const set of sets) {
    const slot = bySlot.get(set.routineExerciseId);
    if (!slot || !Number.isInteger(set.setNumber) || set.setNumber < 1)
      throw notInDay();
    const key = `${slot.id}#${set.setNumber}`;
    if (seen.has(key)) throw notInDay();
    seen.add(key);
    const prescribed = slot.sets.length;
    if (set.setNumber > prescribed + MAX_EXTRA_SETS) {
      throw new BadRequestException(
        apiError("EXTRA_SETS_MAX", { max: MAX_EXTRA_SETS }),
      );
    }
    if (set.setNumber > prescribed) {
      extras.set(slot.id, [...(extras.get(slot.id) ?? []), set.setNumber]);
    }
    assertValues({
      weight: set.weight,
      reps: set.reps,
      rpe: set.rpe ?? null,
      isCompleted: set.isCompleted,
    });
    const prescription = slot.sets.find(
      (row) => row.setNumber === set.setNumber,
    );
    rows.push({
      routineExerciseId: slot.id,
      exerciseId: slot.exerciseId,
      setNumber: set.setNumber,
      reps: set.reps,
      weight: set.weight,
      rpe: set.rpe ?? null,
      isCompleted: set.isCompleted,
      kind: set.kind ?? prescription?.kind ?? "WORKING",
    });
  }
  for (const [slotId, numbers] of extras) {
    const prescribed = bySlot.get(slotId)!.sets.length;
    const sorted = [...numbers].sort((a, b) => a - b);
    if (sorted.some((number, index) => number !== prescribed + index + 1)) {
      throw new BadRequestException(apiError("EXTRA_SET_NOT_NEXT"));
    }
  }
  if (!rows.some((row) => row.isCompleted && row.reps >= 1)) {
    throw new BadRequestException(apiError("LOGGED_WORKOUT_NO_SETS"));
  }
  return rows;
}

/**
 * The week each 8-week slot was on in the logged workout: the member's
 * choice, else the week before the one the slot is on now. Only a slot with
 * a block has one.
 */
export function loggedBlockSteps(
  slots: LoggedDaySlot[],
  requested: LoggedBlockStep[] = [],
): Map<string, number> {
  const chosen = new Map(
    requested.map((entry) => [entry.routineExerciseId, entry.step]),
  );
  const steps = new Map<string, number>();
  for (const slot of slots) {
    const state = slot.linearPeriodization;
    if (slot.progressionScheme !== "LINEAR_PERIODIZATION" || !state) continue;
    const step = chosen.get(slot.id) ?? Math.max(1, state.step - 1);
    if (!Number.isInteger(step) || step < 1 || step > 8) {
      throw new BadRequestException(
        apiError("LINEAR_BLOCK_INVALID", {
          reason: "The block step must be between 1 and 8",
        }),
      );
    }
    steps.set(slot.id, step);
  }
  return steps;
}

type SnapshotExercise = {
  id: string;
  minWeightIncrement: number;
  linearPeriodization?: LinearPeriodizationState | null;
  sets: Array<{ setNumber: number; weight?: number | null; kind?: SetKind }>;
};

/**
 * The day as the logged workout trained it: the routine's day now, with each
 * 8-week slot rewound to the week the member named and its working sets at
 * that week's load, so the history never claims a later week's prescription.
 */
export function rewindLoggedDay<D extends { exercises: SnapshotExercise[] }>(
  day: D,
  steps: Map<string, number>,
): D {
  return {
    ...day,
    exercises: day.exercises.map((exercise) => {
      const step = steps.get(exercise.id);
      const state = exercise.linearPeriodization;
      if (step === undefined || !state) return exercise;
      const rewound = lpAtStep(state, step);
      const loads = lpStoredSets(rewound, exercise.minWeightIncrement);
      let working = 0;
      return {
        ...exercise,
        linearPeriodization: rewound,
        sets: exercise.sets.map((set) => {
          if ((set.kind ?? "WORKING") === "WARMUP") return set;
          const load = loads[working];
          working += 1;
          return load ? { ...set, weight: load.weight } : set;
        }),
      };
    }),
  };
}

/** A refusal the service decides from what it read. */
export const loggedWorkoutConflict = (
  code: "LOGGED_WORKOUT_OVERLAP" | "LOGGED_WORKOUT_SAME_DAY" | "LOGGED_WORKOUT_LIMIT",
  params?: Record<string, number>,
) => new ConflictException(apiError(code, params));
