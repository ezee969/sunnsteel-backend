import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, WorkoutAnalyticsProjection } from "@prisma/client";
import type {
  MeasurableGoalDirection,
  PersonalGoalProgress,
  PersonalGoalsResponse,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import {
  mapMeasurableGoal,
  measurableGoalSelect,
} from "../goals/measurable-goals.service";
import {
  dayDifference,
  localDate,
  weekDate,
} from "./analytics/analytics-contribution";
import { WorkoutProgressQueryDto } from "./dto/workout-progress.dto";

const round = (value: number, precision = 2) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

export function calculateGoalProgress(
  currentValue: number | null,
  targetValue: number,
  direction: MeasurableGoalDirection,
): Pick<
  PersonalGoalProgress,
  "currentValue" | "remainingValue" | "progressPercent" | "achieved"
> {
  if (currentValue === null || !Number.isFinite(currentValue)) {
    return {
      currentValue: null,
      remainingValue: null,
      progressPercent: null,
      achieved: null,
    };
  }
  const achieved =
    direction === "AT_LEAST"
      ? currentValue >= targetValue
      : currentValue <= targetValue;
  const remainingValue = Math.max(
    0,
    direction === "AT_LEAST"
      ? targetValue - currentValue
      : currentValue - targetValue,
  );
  return {
    currentValue: round(currentValue),
    remainingValue: round(remainingValue),
    progressPercent:
      direction === "AT_LEAST"
        ? round(Math.min(100, (currentValue / targetValue) * 100), 1)
        : null,
    achieved,
  };
}

@Injectable()
export class WorkoutPersonalGoalsService {
  constructor(private readonly db: DatabaseService) {}

  async getPersonalGoals(
    userId: string,
    query: WorkoutProgressQueryDto,
  ): Promise<PersonalGoalsResponse> {
    const now = new Date();
    const localToday = localDate(now, query.timeZone);
    const currentWeek = weekDate(localToday);

    return this.db.$transaction(
      async (tx) => {
        const [[projection], goals, user] = await Promise.all([
          tx.$queryRaw<WorkoutAnalyticsProjection[]>`
            SELECT * FROM "WorkoutAnalyticsProjection"
            WHERE "userId" = ${userId} AND "active" AND "state" = 'READY'
              AND "timeZone" = ${query.timeZone}
            LIMIT 1`,
          tx.measurableGoal.findMany({
            where: { userId },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: measurableGoalSelect,
          }),
          tx.user.findUnique({
            where: { id: userId },
            select: { weight: true },
          }),
        ]);
        if (!projection) {
          throw new ServiceUnavailableException(
            "Workout analytics projection is not ready",
          );
        }

        const strengthExerciseIds = goals.flatMap((goal) =>
          goal.type === "EXERCISE_ESTIMATED_1RM" && goal.exerciseId
            ? [goal.exerciseId]
            : [],
        );
        const [week, records] = await Promise.all([
          tx.workoutRollup.findUnique({
            where: {
              projectionId_period_date: {
                projectionId: projection.id,
                period: "WEEK",
                date: currentWeek,
              },
            },
            select: { sessions: true, volumeKg: true },
          }),
          strengthExerciseIds.length
            ? tx.personalRecord.findMany({
                where: {
                  userId,
                  exerciseId: { in: strengthExerciseIds },
                },
                select: { exerciseId: true, estimated1rm: true },
              })
            : [],
        ]);
        const recordsByExercise = new Map(
          records.map(
            (record) => [record.exerciseId, record.estimated1rm] as const,
          ),
        );
        const currentStreak =
          projection.lastTrainingDate &&
          dayDifference(localToday, projection.lastTrainingDate) <= 3
            ? projection.currentRun
            : 0;

        return {
          timeZone: query.timeZone,
          asOf: now.toISOString(),
          goals: goals.map((goal): PersonalGoalProgress => {
            const stored = mapMeasurableGoal(goal);
            const currentValue =
              goal.type === "WEEKLY_SESSIONS"
                ? (week?.sessions ?? 0)
                : goal.type === "WEEKLY_VOLUME"
                  ? (week?.volumeKg ?? 0)
                  : goal.type === "STREAK_DAYS"
                    ? currentStreak
                    : goal.type === "EXERCISE_ESTIMATED_1RM"
                      ? (recordsByExercise.get(goal.exerciseId!) ?? null)
                      : (user?.weight ?? null);
            return {
              ...stored,
              ...calculateGoalProgress(
                currentValue,
                goal.targetValue,
                goal.direction,
              ),
              ...(goal.type === "WEEKLY_SESSIONS" ||
              goal.type === "WEEKLY_VOLUME"
                ? { periodStart: currentWeek }
                : {}),
            };
          }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
