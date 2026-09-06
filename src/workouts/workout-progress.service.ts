import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, WorkoutAnalyticsProjection } from '@prisma/client';
import { WorkoutProgressResponse } from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { WorkoutProgressQueryDto } from './dto/workout-progress.dto';
import { dayNameFrom } from './workout-session.selects';
import { LegacyWorkoutProgressService } from './analytics/legacy-workout-progress.service';
import { dayDifference, localDate } from './analytics/analytics-contribution';
import { readSnapshot } from './analytics/session-snapshot';
export { computeStreaks } from './analytics/legacy-workout-progress.service';

@Injectable()
export class WorkoutProgressService {
  constructor(private readonly db: DatabaseService) {}

  async getProgress(
    userId: string,
    query: WorkoutProgressQueryDto,
  ): Promise<WorkoutProgressResponse> {
    if (process.env.WORKOUT_PROGRESS_PROJECTION_READS !== 'true') {
      return new LegacyWorkoutProgressService(this.db).getProgress(
        userId,
        query,
      );
    }
    return this.getProjectedProgress(userId, query);
  }

  async getProjectedProgress(
    userId: string,
    query: WorkoutProgressQueryDto,
  ): Promise<WorkoutProgressResponse> {
    return this.db.$transaction(
      async (tx) => {
        // Static partial-index predicates avoid Prisma's text-to-enum cast and
        // remain indexable even when PostgreSQL chooses a generic prepared plan.
        const [projection] = await tx.$queryRaw<WorkoutAnalyticsProjection[]>`
          SELECT * FROM "WorkoutAnalyticsProjection"
          WHERE "userId" = ${userId} AND "active" AND "state" = 'READY' AND "timeZone" = ${query.timeZone} LIMIT 1`;
        if (!projection)
          throw new ServiceUnavailableException(
            'Workout analytics projection is not ready',
          );
        const records = await tx.personalRecord.findMany({
          where: { userId },
          orderBy: { achievedAt: 'desc' },
          take: 5,
          select: {
            exerciseId: true,
            exerciseName: true,
            weight: true,
            reps: true,
            estimated1rm: true,
            achievedAt: true,
          },
        });
        const sessions = await tx.$queryRaw<
          Array<{
            id: string;
            startedAt: Date;
            endedAt: Date | null;
            durationSec: number | null;
            totalVolumeKg: number;
            completedSets: number;
            payload: Prisma.JsonValue;
          }>
        >`SELECT s."id", s."startedAt", s."endedAt", s."durationSec", s."totalVolumeKg", s."completedSets", sn."payload"
          FROM "WorkoutSession" s LEFT JOIN "WorkoutSessionSnapshot" sn ON sn."sessionId" = s."id"
          WHERE s."userId" = ${userId} AND s."status" = 'COMPLETED' AND s."completedSets" > 0
          ORDER BY s."endedAt" DESC, s."id" DESC LIMIT 5`;
        return {
          totalVolumeKg: Math.round(projection.totalVolumeKg),
          currentStreakDays:
            projection.lastTrainingDate &&
            dayDifference(
              localDate(new Date(), query.timeZone),
              projection.lastTrainingDate,
            ) <= 3
              ? projection.currentRun
              : 0,
          bestStreakDays: projection.bestRun,
          personalRecords: records.map((r) => ({
            ...r,
            achievedAt: r.achievedAt.toISOString(),
          })),
          recentActivity: sessions.map((session) => {
            const snapshot = readSnapshot(session.payload);
            return {
              sessionId: session.id,
              routineId: snapshot.sourceRoutineId,
              routineName: snapshot.routine.name,
              dayName: dayNameFrom(snapshot.routineDay.dayOfWeek!),
              startedAt: session.startedAt.toISOString(),
              endedAt: session.endedAt?.toISOString() ?? null,
              durationSec: session.durationSec,
              totalVolumeKg: Math.round(session.totalVolumeKg!),
              completedSets: session.completedSets!,
            };
          }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
