import { Prisma } from '@prisma/client';
import { WorkoutAnalyticsStatus } from '@sunsteel/contracts';

/**
 * LIVE-23: history changed earlier than the newest analytics generation has
 * read -- a workout logged after it happened, or one of those removed -- so
 * every derived number is replayed from the start in a new generation, as a
 * time-zone change does. A generation still building is superseded rather
 * than reused, because its cursor may already be past the changed date. The
 * previous READY generation keeps serving until the new one activates. With
 * no generation yet there is nothing to replay: the first build reads
 * everything. The caller holds the account lock.
 */
export async function startHistoryRebuild(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<WorkoutAnalyticsStatus> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timeZone: true, analyticsProjectionId: true },
  });
  const select = { id: true, timeZone: true, state: true } as const;
  const latest =
    (user.analyticsProjectionId
      ? await tx.workoutAnalyticsProjection.findUnique({
          where: { id: user.analyticsProjectionId },
          select,
        })
      : null) ??
    (await tx.workoutAnalyticsProjection.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select,
    }));
  if (!latest) {
    return {
      timeZone: user.timeZone,
      requestedTimeZone: null,
      state: 'UNINITIALIZED',
      generationId: null,
    };
  }
  await tx.analyticsBackfillJob.updateMany({
    where: { projection: { userId, state: 'BUILDING' } },
    data: { state: 'CANCELLED' },
  });
  await tx.workoutAnalyticsProjection.updateMany({
    where: { userId, state: 'BUILDING' },
    data: { state: 'SUPERSEDED' },
  });
  const projection = await tx.workoutAnalyticsProjection.create({
    data: { userId, timeZone: latest.timeZone, job: { create: {} } },
    select: { id: true, timeZone: true },
  });
  await tx.user.update({
    where: { id: userId },
    data: { analyticsProjectionId: projection.id },
  });
  return {
    timeZone: user.timeZone,
    requestedTimeZone: projection.timeZone,
    state: 'BUILDING',
    generationId: projection.id,
  };
}
