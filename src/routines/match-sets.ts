import { BadRequestException } from "@nestjs/common";
import {
  MATCH_SETS_MAX,
  apiError,
  matchSetRefusal,
  type SetKind,
} from "@sunsteel/contracts";

type PrescribedSet = { setNumber: number; kind?: SetKind | null };

/**
 * LIVE-26: 400 when a prescription's match sets cannot be stored -- one not
 * after a working set, more than `MATCH_SETS_MAX` in a row, or any on an
 * 8-week block.
 */
export function assertMatchSets(
  sets: readonly PrescribedSet[],
  linearBlock: boolean,
): void {
  const refusal = matchSetRefusal(sets, linearBlock);
  if (refusal === "MATCH_SETS_MAX")
    throw new BadRequestException(apiError(refusal, { max: MATCH_SETS_MAX }));
  if (refusal) throw new BadRequestException(apiError(refusal));
}

/**
 * LIVE-26: a match set has no load and no rep prescription of its own -- it
 * lifts its target set's load against that set's logged reps -- so whatever
 * a client sends for them is not stored.
 */
export const isMatchSet = (set: { kind?: SetKind | null }) =>
  set.kind === "MATCH";
