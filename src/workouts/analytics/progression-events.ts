import { Prisma } from '@prisma/client';
import type { ProgressionChange } from '@sunsteel/contracts';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const eventKey = (sessionId: string, routineExerciseId: string) =>
  `session:${sessionId}:progression:${routineExerciseId}:v1`;

export async function writeProgressionEvents(
  tx: Prisma.TransactionClient,
  userId: string,
  sessionId: string,
  occurredAt: Date,
  changes: ProgressionChange[],
) {
  await Promise.all(
    changes.map((change) =>
      tx.trainingEvent.upsert({
        where: { eventKey: eventKey(sessionId, change.routineExerciseId) },
        update: {},
        create: {
          eventKey: eventKey(sessionId, change.routineExerciseId),
          userId,
          sessionId,
          type: 'PROGRESSION_CHANGED',
          occurredAt,
          payload: json({ schemaVersion: 1, ...change }),
        },
      }),
    ),
  );
}

export async function readProgressionEvents(
  tx: Prisma.TransactionClient,
  sessionId: string,
  routineExerciseIds: string[],
): Promise<ProgressionChange[]> {
  if (routineExerciseIds.length === 0) return [];
  const events = await tx.trainingEvent.findMany({
    where: {
      eventKey: {
        in: routineExerciseIds.map((id) => eventKey(sessionId, id)),
      },
      type: 'PROGRESSION_CHANGED',
    },
    orderBy: { eventKey: 'asc' },
    select: { payload: true },
  });
  return events.map(
    ({ payload }) => payload as unknown as ProgressionChange,
  );
}
