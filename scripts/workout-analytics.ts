import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../src/database/database.service';
import { AnalyticsService } from '../src/workouts/analytics/analytics.service';
import { WorkoutProgressService } from '../src/workouts/workout-progress.service';
import { LegacyWorkoutProgressService } from '../src/workouts/analytics/legacy-workout-progress.service';
import { lockTrainingAccount } from '../src/workouts/analytics/analytics-lock';

/** Offline administration: never mounts the Nest application or starts its scheduler. */
async function main() {
  const [command, userId, timeZone] = process.argv.slice(2);
  const db = new DatabaseService();
  const analytics = new AnalyticsService(db);
  try {
    if (command === 'status') {
      console.log(
        JSON.stringify(
          {
            unregisteredAccounts: await db.user.count({
              where: { analyticsProjections: { none: {} } },
            }),
            pendingAccounts: await db.user.count({
              where: {
                analyticsProjections: {
                  none: { active: true, state: 'READY' },
                },
              },
            }),
            jobs: await db.analyticsBackfillJob.groupBy({
              by: ['state'],
              _count: true,
            }),
            ...(userId
              ? {
                  account: await analytics.status(userId),
                  generations: await db.workoutAnalyticsProjection.findMany({
                    where: { userId },
                    include: { job: true },
                    orderBy: { createdAt: 'desc' },
                  }),
                }
              : {}),
          },
          null,
          2,
        ),
      );
    } else if (command === 'batch') {
      console.log(JSON.stringify(await analytics.runBatch()));
    } else if (command === 'rebuild' && userId && timeZone) {
      new Intl.DateTimeFormat('en', { timeZone }).format();
      console.log(
        JSON.stringify(
          await analytics.rebuild(
            userId,
            new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions()
              .timeZone,
          ),
        ),
      );
    } else if (command === 'compare' && userId) {
      // Lock out finishes and routine edits so two implementations see the same
      // state. Reads are sequential inside this snapshot, not on separate clients.
      const comparison = await db.$transaction(
        async (tx) => {
          await lockTrainingAccount(tx, userId);
          const status = await analytics.status(userId, tx);
          if (!status.timeZone)
            throw new Error('No active projection for comparison');
          const adapter = new Proxy(tx, {
            get(target, key) {
              if (key === '$transaction')
                return (
                  callback: (client: Prisma.TransactionClient) => unknown,
                ) => callback(tx);
              return Reflect.get(target, key);
            },
          }) as DatabaseService;
          const query = { timeZone: status.timeZone };
          const old = await new LegacyWorkoutProgressService(
            adapter,
          ).getProgress(userId, query);
          const projected = await new WorkoutProgressService(
            adapter,
          ).getProjectedProgress(userId, query);
          return {
            userId,
            timeZone: status.timeZone,
            matches: JSON.stringify(old) === JSON.stringify(projected),
            legacy: old,
            projected,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 60_000,
        },
      );
      console.log(JSON.stringify(comparison, null, 2));
      if (!comparison.matches) process.exitCode = 1;
    } else {
      throw new Error(
        'Usage: workout-analytics.ts status [userId] | batch | rebuild <userId> <IANA zone> | compare <userId>',
      );
    }
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
