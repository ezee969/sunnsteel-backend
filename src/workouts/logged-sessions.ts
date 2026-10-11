import { Prisma } from '@prisma/client';

type Db = Pick<Prisma.TransactionClient, 'workoutSession'>;

/**
 * LIVE-23: the members' workouts logged after they happened. They count for
 * their member and are never announced, so what reads training events to
 * tell others -- the activity feed, owner notifications -- leaves their
 * events out. Few per member (a routine holds a bounded number).
 */
export async function loggedLaterSessionIds(
  db: Db,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db.workoutSession.findMany({
    where: { userId: { in: userIds }, origin: 'LOGGED_LATER' },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * Events from anything but those workouts. `sessionId` is null on events
 * with no session (a milestone recognized from history), which `NOT IN`
 * alone would drop.
 */
export const notFromSessions = (
  sessionIds: string[],
): Prisma.TrainingEventWhereInput =>
  sessionIds.length
    ? { OR: [{ sessionId: null }, { sessionId: { notIn: sessionIds } }] }
    : {};
