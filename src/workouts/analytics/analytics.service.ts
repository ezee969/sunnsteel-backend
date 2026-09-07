import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import {
  SetAccountTimeZoneRequest,
  WorkoutAnalyticsStatus,
} from '@sunsteel/contracts';
import { DatabaseService } from '../../database/database.service';
import { lockTrainingAccount } from './analytics-lock';
import { applyContribution, summarizeSession } from './analytics-writer';
import { ensureSessionSnapshot } from './session-snapshot';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  constructor(private readonly db: DatabaseService) {}

  async status(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<WorkoutAnalyticsStatus> {
    if (!tx)
      return this.db.$transaction((client) => this.status(userId, client), {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timeZone: true, analyticsProjectionId: true },
    });
    const latest = user.analyticsProjectionId
      ? await tx.workoutAnalyticsProjection.findUnique({
          where: { id: user.analyticsProjectionId },
        })
      : null;
    return {
      timeZone: user.timeZone,
      requestedTimeZone: latest?.timeZone ?? null,
      state:
        (latest?.state as WorkoutAnalyticsStatus['state']) ?? 'UNINITIALIZED',
      generationId: latest?.id ?? null,
    };
  }

  async setTimeZone(
    userId: string,
    request: SetAccountTimeZoneRequest,
  ): Promise<WorkoutAnalyticsStatus> {
    // DTO validates IANA; canonicalization makes aliases idempotent too.
    const timeZone = new Intl.DateTimeFormat('en', {
      timeZone: request.timeZone,
    }).resolvedOptions().timeZone;
    return this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      const status = await this.status(userId, tx);
      if (
        request.onlyIfUnset &&
        status.state !== 'UNINITIALIZED' &&
        status.state !== 'FAILED'
      )
        return status;
      const desired = request.onlyIfUnset
        ? (status.requestedTimeZone ?? timeZone)
        : timeZone;
      if (status.requestedTimeZone === desired && status.state !== 'FAILED')
        return status;
      // Superseded jobs remain auditable but cannot activate later.
      await tx.analyticsBackfillJob.updateMany({
        where: { projection: { userId, state: 'BUILDING' } },
        data: { state: 'CANCELLED' },
      });
      await tx.workoutAnalyticsProjection.updateMany({
        where: { userId, state: 'BUILDING' },
        data: { state: 'SUPERSEDED' },
      });
      const projection = await tx.workoutAnalyticsProjection.create({
        data: { userId, timeZone: desired, job: { create: {} } },
      });
      await tx.user.update({
        where: { id: userId },
        data: { analyticsProjectionId: projection.id },
      });
      return this.status(userId, tx);
    });
  }

  /** Explicit rebuild always creates an empty generation; never adds to old data. */
  async rebuild(userId: string, timeZone: string) {
    return this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      const building = await tx.workoutAnalyticsProjection.findFirst({
        where: { userId, state: 'BUILDING' },
      });
      if (building) return building;
      const projection = await tx.workoutAnalyticsProjection.create({
        data: { userId, timeZone, job: { create: {} } },
      });
      await tx.user.update({
        where: { id: userId },
        data: { analyticsProjectionId: projection.id },
      });
      return projection;
    });
  }

  @Interval(5_000)
  async tick() {
    if (process.env.WORKOUT_ANALYTICS_JOBS !== 'true') return;
    try {
      await this.runBatch();
    } catch (error) {
      this.logger.error('Analytics batch failed', error);
    }
  }

  // Snapshot capture makes several round trips per session. Keep the default
  // small enough for a remote database and the 30-second transaction budget.
  async runBatch(batchSize = 2) {
    const started = Date.now();
    // Account before job is the lock order used by every writer. Skip a busy
    // account instead of blocking another worker or a live session finish.
    return this.db.$transaction(
      async (tx) => {
        const accounts = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT u."id" FROM "User" u WHERE EXISTS (
          SELECT 1 FROM "WorkoutAnalyticsProjection" p JOIN "AnalyticsBackfillJob" j ON j."projectionId" = p."id"
          WHERE p."userId" = u."id" AND p."state" = 'BUILDING' AND j."state" = 'PENDING'
        ) ORDER BY u."id" FOR UPDATE OF u SKIP LOCKED LIMIT 1`;
        if (!accounts.length) return null;
        const userId = accounts[0].id;
        const jobs = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT j."id" FROM "AnalyticsBackfillJob" j JOIN "WorkoutAnalyticsProjection" p ON p."id" = j."projectionId"
        WHERE p."userId" = ${userId} AND p."state" = 'BUILDING' AND j."state" = 'PENDING'
        FOR UPDATE OF j SKIP LOCKED LIMIT 1`;
        if (!jobs.length) return null;
        const job = await tx.analyticsBackfillJob.findUniqueOrThrow({
          where: { id: jobs[0].id },
          include: { projection: true },
        });
        // Savepoint retains the claim and persists error/attempt metadata while
        // rolling back every contribution and cursor on a failed batch.
        await tx.$executeRawUnsafe('SAVEPOINT analytics_batch');
        try {
          if (!job.snapshotsComplete) {
            const sessions = await tx.workoutSession.findMany({
              where: {
                userId,
                ...(job.snapshotCursorSessionId
                  ? { id: { gt: job.snapshotCursorSessionId } }
                  : {}),
              },
              orderBy: { id: 'asc' },
              take: Math.max(1, Math.min(batchSize, 100)),
              select: { id: true, snapshot: { select: { provenance: true } } },
            });
            for (const session of sessions)
              await ensureSessionSnapshot(tx, session.id);
            await tx.analyticsBackfillJob.update({
              where: { id: job.id },
              data: {
                snapshotCursorSessionId: sessions.at(-1)?.id,
                snapshotsComplete: sessions.length === 0,
                approximatedSessions: {
                  increment: sessions.filter(
                    (s) => s.snapshot?.provenance !== 'CAPTURED',
                  ).length,
                },
                attempts: 0,
                error: null,
              },
            });
            return { jobId: job.id, snapshots: sessions.length };
          }
          const sessions = await tx.workoutSession.findMany({
            where: {
              userId,
              status: 'COMPLETED',
              endedAt: { not: null },
              ...(job.cursorEndedAt
                ? {
                    OR: [
                      { endedAt: { gt: job.cursorEndedAt } },
                      {
                        endedAt: job.cursorEndedAt,
                        id: { gt: job.cursorSessionId! },
                      },
                    ],
                  }
                : {}),
            },
            orderBy: [{ endedAt: 'asc' }, { id: 'asc' }],
            take: Math.max(1, Math.min(batchSize, 100)),
            select: {
              id: true,
              endedAt: true,
              snapshot: { select: { provenance: true } },
            },
          });
          let projection = job.projection;
          for (const session of sessions)
            projection = await applyContribution(
              tx,
              projection,
              await summarizeSession(tx, session.id),
            );
          const last = sessions.at(-1);
          await tx.analyticsBackfillJob.update({
            where: { id: job.id },
            data: {
              ...(last
                ? { cursorEndedAt: last.endedAt, cursorSessionId: last.id }
                : {}),
              processedSessions: { increment: sessions.length },
              error: null,
              attempts: 0,
            },
          });
          // With the account locked there is no unobserved finish between this
          // empty-tail read and the swap. Future finishes see the new active row.
          if (sessions.length === 0) {
            await tx.workoutAnalyticsProjection.updateMany({
              where: { userId, active: true },
              data: { active: false },
            });
            await tx.workoutAnalyticsProjection.update({
              where: { id: projection.id },
              data: { active: true, state: 'READY' },
            });
            await tx.user.update({
              where: { id: userId },
              data: { timeZone: projection.timeZone },
            });
            await tx.analyticsBackfillJob.update({
              where: { id: job.id },
              data: { state: 'COMPLETED' },
            });
          }
          this.logger.log(
            `Analytics batch ${job.id}: ${sessions.length} sessions, ${Date.now() - started}ms`,
          );
          return {
            jobId: job.id,
            processed: sessions.length,
            checksum: projection.checksum,
          };
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT analytics_batch');
          const attempts = job.attempts + 1;
          await tx.analyticsBackfillJob.update({
            where: { id: job.id },
            data: {
              attempts,
              error: error instanceof Error ? error.message : 'Batch failed',
              state: attempts >= 3 ? 'FAILED' : 'PENDING',
            },
          });
          if (attempts >= 3)
            await tx.workoutAnalyticsProjection.update({
              where: { id: job.projectionId },
              data: { state: 'FAILED' },
            });
          return { jobId: job.id, failed: true };
        }
      },
      { timeout: 30_000, maxWait: 5_000 },
    );
  }
}
