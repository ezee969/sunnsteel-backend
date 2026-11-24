import { BadRequestException } from "@nestjs/common";
import type { SetKind } from "@sunsteel/contracts";
import { isMatchSet } from "./match-sets";

export type RoutineSetInput = {
  setNumber: number;
  repType: "RANGE" | "FIXED";
  reps?: number | null;
  minReps?: number | null;
  maxReps?: number | null;
  weight?: number | null;
  rir?: number | null;
  kind?: SetKind;
  warmUpShare?: number | null;
};

/**
 * One prescribed set as stored: the rep prescription checked against its
 * type, a match set stored without a load or reps of its own (LIVE-26). Used
 * by every routine write and by an exercise added during a workout (LIVE-25).
 */
export function routineSetCreateData(set: RoutineSetInput, openReps = false) {
  // LIVE-26: a match set lifts its target set's load against that set's
  // logged reps, so it stores neither.
  if (isMatchSet(set)) {
    return {
      setNumber: set.setNumber,
      repType: "FIXED" as const,
      weight: null,
      kind: "MATCH" as const,
      warmUpShare: null,
    };
  }
  if (set.repType === "RANGE") {
    if (typeof set.minReps !== "number" || typeof set.maxReps !== "number") {
      throw new BadRequestException(
        "For RANGE repType, minReps and maxReps are required",
      );
    }
    if (set.minReps > set.maxReps) {
      throw new BadRequestException(
        "minReps must be less than or equal to maxReps",
      );
    }
  } else if (set.repType === "FIXED") {
    // ROUT-17: an 8-week block's working sets have no rep target.
    const open = openReps && (set.kind ?? "WORKING") !== "WARMUP";
    if (typeof set.reps !== "number" && !open) {
      throw new BadRequestException("For FIXED repType, reps is required");
    }
  }

  const repTypeVal: "RANGE" | "FIXED" =
    set.repType === "RANGE" ? "RANGE" : "FIXED";

  return {
    setNumber: set.setNumber,
    repType: repTypeVal,
    weight: set.weight,
    kind: set.kind ?? "WORKING",
    // LIVE-20: only a warm-up carries a share.
    warmUpShare:
      (set.kind ?? "WORKING") === "WARMUP" &&
      typeof set.warmUpShare === "number"
        ? set.warmUpShare
        : null,
    ...(typeof set.rir === "number" ? { rir: set.rir } : {}),
    ...(repTypeVal === "FIXED" && typeof set.reps === "number"
      ? { reps: set.reps }
      : {}),
    ...(repTypeVal === "RANGE" &&
    typeof set.minReps === "number" &&
    typeof set.maxReps === "number"
      ? { minReps: set.minReps, maxReps: set.maxReps }
      : {}),
  };
}
