import { BadRequestException } from '@nestjs/common';
import {
  CLONE_ROUTINE_REFUSALS,
  type CloneRoutineRequest,
  type RoutineVersionSetup,
} from '@sunsteel/contracts';
import { setupToRoutineUpdate } from './routine-versions';

/**
 * ROUT-05. A clone is the prescription somebody was allowed to read, saved as
 * a routine of the reader's own.
 *
 * It reuses the two pieces that already exist rather than projecting a routine
 * a third time: the payload is `SharedRoutine.setup`, the `RoutineVersionSetup`
 * a `ROUT-08` version stores, and `setupToRoutineUpdate` is what turns one back
 * into a routine when a version is restored. Nothing here can carry a session,
 * a record or a note, because that shape has nowhere to put one.
 */

export type CloneSource =
  | { kind: 'LINK'; token: string }
  | { kind: 'VISIBILITY'; routineId: string };

/**
 * Exactly one source. Both at once is rejected rather than silently preferring
 * one: a link and a visibility read answer different questions about who may
 * read the routine, and guessing which the caller meant could widen access.
 */
export function readCloneSource(request: CloneRoutineRequest): CloneSource {
  const token = request.token?.trim();
  const routineId = request.routineId?.trim();
  if (!!token === !!routineId) {
    throw new BadRequestException(
      `${CLONE_ROUTINE_REFUSALS.SOURCE_REQUIRED}: send either a share token or a routine id`,
    );
  }
  return token
    ? { kind: 'LINK', token }
    : { kind: 'VISIBILITY', routineId: routineId! };
}

/**
 * The routine a clone creates. It is the shared setup and nothing added: the
 * clone's owner, its visibility, its versions and its links all start from the
 * ordinary defaults, so cloning a `PUBLIC` routine never republishes it.
 */
export function setupToClonedRoutine(setup: RoutineVersionSetup) {
  return { ...setupToRoutineUpdate(setup), isPeriodized: false };
}
