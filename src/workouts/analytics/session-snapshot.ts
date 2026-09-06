import { Prisma } from '@prisma/client';
import { WorkoutSessionSnapshotV1 } from '@sunsteel/contracts';
import { buildWorkoutSessionSelect } from '../workout-session.selects';

export function readSnapshot(payload: unknown): WorkoutSessionSnapshotV1 {
  const snapshot = payload as WorkoutSessionSnapshotV1 | null;
  if (
    snapshot?.schemaVersion !== 1 ||
    !snapshot.routine ||
    !snapshot.routineDay
  ) {
    throw new Error('Unsupported or missing session snapshot');
  }
  return snapshot;
}

export async function ensureSessionSnapshot(
  tx: Prisma.TransactionClient,
  sessionId: string,
  provenance: WorkoutSessionSnapshotV1['provenance'] = 'APPROXIMATED',
) {
  const session = await tx.workoutSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: buildWorkoutSessionSelect(),
  });
  if (session.status === 'COMPLETED' && !session.endedAt) {
    throw new Error(
      `Irrecoverable completion timestamp for session ${sessionId}`,
    );
  }
  if (session.snapshot) return readSnapshot(session.snapshot.payload);
  if (!session.routine || !session.routineDay) {
    throw new Error(`Irrecoverable prescription for session ${sessionId}`);
  }
  const snapshot: WorkoutSessionSnapshotV1 = {
    schemaVersion: 1,
    sessionId,
    sourceRoutineId: session.sourceRoutineId ?? session.routineId!,
    sourceRoutineDayId: session.sourceRoutineDayId ?? session.routineDayId!,
    capturedAt: new Date().toISOString(),
    provenance,
    notes: session.notes,
    routine: session.routine,
    routineDay: session.routineDay,
  };
  await tx.workoutSessionSnapshot.create({
    data: {
      sessionId,
      provenance,
      payload: snapshot as unknown as Prisma.InputJsonValue,
    },
  });
  await tx.workoutSession.update({
    where: { id: sessionId },
    data: {
      sourceRoutineId: snapshot.sourceRoutineId,
      sourceRoutineDayId: snapshot.sourceRoutineDayId,
    },
  });
  await tx.$executeRaw`UPDATE "SetLog" SET "sourceRoutineExerciseId" = "routineExerciseId"
    WHERE "sessionId" = ${sessionId} AND "sourceRoutineExerciseId" IS NULL`;
  return snapshot;
}
