import { Prisma } from '@prisma/client';
import { removeActivityEntries } from '../../activity/activity-entry-removal';
import { beatsRecord } from '../session-correction-rules';

export interface RecordEventRow {
  id: string;
  eventKey: string;
  exerciseId: string;
  occurredAt: Date;
  weight: number;
  reps: number;
}

/**
 * The `PERSONAL_RECORD` events that do not beat the best earlier event of
 * their exercise, walking them in the order the progress timeline reads them.
 *
 * A finish never writes one: it compares against everything recorded before
 * it. A replay can leave one behind, because a rebuild only ever adds events.
 * When history is written **before** an event that already exists -- the
 * portfolio seed backdates sessions into a real account -- the replay no
 * longer derives that event, and nothing removed it (TD-58). Dropping every
 * event that does not beat the best before it leaves a chain in which each
 * one does, so applying this twice removes nothing more.
 */
export function staleRecordEvents(rows: RecordEventRow[]): RecordEventRow[] {
  const ordered = [...rows].sort(
    (a, b) =>
      a.occurredAt.getTime() - b.occurredAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const best = new Map<string, { weight: number; reps: number }>();
  const stale: RecordEventRow[] = [];
  for (const row of ordered) {
    if (beatsRecord(row, best.get(row.exerciseId) ?? null)) {
      best.set(row.exerciseId, { weight: row.weight, reps: row.reps });
    } else {
      stale.push(row);
    }
  }
  return stale;
}

/**
 * Removes one account's stale record events and the activity entries built
 * from them; the caller holds the account lock. Returns the removed keys.
 * The migration `20261004120000_stale_record_events` applies the same rule
 * once across every account.
 */
export async function removeStaleRecordEvents(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<string[]> {
  const events = await tx.trainingEvent.findMany({
    where: { userId, type: 'PERSONAL_RECORD' },
    select: { id: true, eventKey: true, occurredAt: true, payload: true },
  });
  const rows = events.flatMap((event): RecordEventRow[] => {
    const payload = event.payload as Record<string, unknown> | null;
    const exerciseId = payload?.exerciseId;
    const weight = payload?.weight;
    const reps = payload?.reps;
    return typeof exerciseId === 'string' &&
      typeof weight === 'number' &&
      typeof reps === 'number'
      ? [
          {
            id: event.id,
            eventKey: event.eventKey,
            occurredAt: event.occurredAt,
            exerciseId,
            weight,
            reps,
          },
        ]
      : [];
  });
  const stale = staleRecordEvents(rows);
  if (!stale.length) return [];
  await tx.trainingEvent.deleteMany({
    where: { id: { in: stale.map((row) => row.id) } },
  });
  const keys = stale.map((row) => row.eventKey);
  await removeActivityEntries(tx, userId, keys);
  return keys;
}
