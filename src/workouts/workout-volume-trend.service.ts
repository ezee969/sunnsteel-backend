import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { WorkoutAnalyticsProjection } from "@prisma/client";
import {
  DEFAULT_WEEK_STARTS_ON,
  isWeekStartsOn,
  MUSCLE_GROUPS,
  type MuscleGroup,
  type VolumeTrendPoint,
  type VolumeTrendResponse,
  type VolumeTrendSeries,
  apiError,
  weekStartOf,
  type WeekStartsOn,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import { localDate } from "./analytics/analytics-contribution";
import { readSnapshot } from "./analytics/session-snapshot";
import type { VolumeTrendQueryDto } from "./dto/volume-trend.dto";
import { getHeatmapWeekStarts } from "./workout-muscle-heatmap.service";
import { COUNTED_SET_LOG } from "./counted-sets";

export const DEFAULT_VOLUME_TREND_WEEKS = 8;

type SeriesAccumulator = {
  id: string;
  name: string;
  points: Map<string, { volumeKg: number; completedSets: number }>;
};

const roundVolume = (value: number) => Math.round(value * 100) / 100;
const roundSets = (value: number) => Math.round(value * 2) / 2;

export function getVolumeTrendLowerBound(firstWeekStart: string): Date {
  return new Date(Date.parse(`${firstWeekStart}T00:00:00.000Z`) - 14 * 3600000);
}

function addToSeries(
  series: Map<string, SeriesAccumulator>,
  id: string,
  name: string,
  weekStart: string,
  volumeKg: number,
  completedSets: number,
) {
  const item = series.get(id) ?? { id, name, points: new Map() };
  const point = item.points.get(weekStart) ?? {
    volumeKg: 0,
    completedSets: 0,
  };
  point.volumeKg += volumeKg;
  point.completedSets += completedSets;
  item.points.set(weekStart, point);
  item.name = name;
  series.set(id, item);
}

function serializeSeries(
  values: Iterable<SeriesAccumulator>,
  weekStarts: string[],
  currentWeekStart: string,
): VolumeTrendSeries[] {
  return [...values]
    .map((value) => {
      const points = weekStarts.map((weekStart) => {
        const point = value.points.get(weekStart);
        return {
          weekStart,
          isCurrentWeek: weekStart === currentWeekStart,
          volumeKg: roundVolume(point?.volumeKg ?? 0),
          completedSets: roundSets(point?.completedSets ?? 0),
        };
      });
      return {
        id: value.id,
        name: value.name,
        totalVolumeKg: roundVolume(
          points.reduce((total, point) => total + point.volumeKg, 0),
        ),
        totalCompletedSets: roundSets(
          points.reduce((total, point) => total + point.completedSets, 0),
        ),
        points,
      };
    })
    .sort(
      (a, b) =>
        b.totalVolumeKg - a.totalVolumeKg ||
        b.totalCompletedSets - a.totalCompletedSets ||
        a.name.localeCompare(b.name),
    );
}

@Injectable()
export class WorkoutVolumeTrendService {
  constructor(private readonly db: DatabaseService) {}

  async getVolumeTrend(
    userId: string,
    query: VolumeTrendQueryDto,
  ): Promise<VolumeTrendResponse> {
    const weeksCount = query.weeks ?? DEFAULT_VOLUME_TREND_WEEKS;
    const now = new Date();
    const localToday = localDate(now, query.timeZone);

    return this.db.$transaction(
      async (tx) => {
        // PREF-04: weeks are the member's, built from the day rows, because
        // the WEEK rows stay Monday weeks for the rank.
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { weekStartsOn: true },
        });
        const weekStartsOn: WeekStartsOn = isWeekStartsOn(user?.weekStartsOn)
          ? user.weekStartsOn
          : DEFAULT_WEEK_STARTS_ON;
        const weekOf = (date: string) => weekStartOf(date, weekStartsOn);
        const currentWeekStart = weekOf(localToday);
        const weekStarts = getHeatmapWeekStarts(currentWeekStart, weeksCount);
        const weekSet = new Set(weekStarts);
        const lowerBound = getVolumeTrendLowerBound(weekStarts[0]);

        const [projection] = await tx.$queryRaw<WorkoutAnalyticsProjection[]>`
          SELECT * FROM "WorkoutAnalyticsProjection"
          WHERE "userId" = ${userId} AND "active" AND "state" = 'READY' AND "timeZone" = ${query.timeZone} LIMIT 1`;
        if (!projection)
          throw new ServiceUnavailableException(
            apiError("ANALYTICS_NOT_READY"),
          );

        const overallRows = await tx.workoutRollup.findMany({
          where: {
            projectionId: projection.id,
            period: "DAY",
            date: { gte: weekStarts[0], lte: localToday },
          },
          orderBy: { date: "asc" },
          select: { date: true, volumeKg: true, completedSets: true },
        });
        const muscleRows = await tx.workoutMuscleRollup.findMany({
          where: {
            projectionId: projection.id,
            period: "DAY",
            date: { gte: weekStarts[0], lte: localToday },
          },
          orderBy: [{ date: "asc" }, { muscle: "asc" }],
          select: {
            date: true,
            muscle: true,
            volumeKg: true,
            completedSets: true,
          },
        });
        const sessions = await tx.workoutSession.findMany({
          where: {
            userId,
            status: "COMPLETED",
            endedAt: { gte: lowerBound, lte: now },
            completedSets: { gt: 0 },
          },
          orderBy: [{ endedAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            endedAt: true,
            sourceRoutineId: true,
            totalVolumeKg: true,
            completedSets: true,
            snapshot: { select: { payload: true } },
          },
        });
        const logs = await tx.setLog.findMany({
          where: {
            ...COUNTED_SET_LOG,
            session: {
              userId,
              status: "COMPLETED",
              endedAt: { gte: lowerBound, lte: now },
            },
          },
          orderBy: [{ session: { endedAt: "asc" } }, { id: "asc" }],
          select: {
            weight: true,
            reps: true,
            exerciseId: true,
            exercise: { select: { name: true } },
            session: { select: { endedAt: true } },
          },
        });

        const overallByWeek = new Map<
          string,
          { volumeKg: number; completedSets: number }
        >();
        for (const row of overallRows) {
          const week = weekOf(row.date);
          const sum = overallByWeek.get(week) ?? { volumeKg: 0, completedSets: 0 };
          sum.volumeKg += row.volumeKg;
          sum.completedSets += row.completedSets;
          overallByWeek.set(week, sum);
        }
        const overall: VolumeTrendPoint[] = weekStarts.map((weekStart) => {
          const row = overallByWeek.get(weekStart);
          return {
            weekStart,
            isCurrentWeek: weekStart === currentWeekStart,
            volumeKg: roundVolume(row?.volumeKg ?? 0),
            completedSets: row?.completedSets ?? 0,
          };
        });

        const muscles = new Map<string, SeriesAccumulator>(
          MUSCLE_GROUPS.map((muscle) => [
            muscle,
            { id: muscle, name: muscle, points: new Map() },
          ]),
        );
        for (const row of muscleRows) {
          if (!MUSCLE_GROUPS.includes(row.muscle as MuscleGroup)) continue;
          addToSeries(
            muscles,
            row.muscle,
            row.muscle,
            weekOf(row.date),
            row.volumeKg,
            row.completedSets,
          );
        }

        const routines = new Map<string, SeriesAccumulator>();
        for (const session of sessions) {
          if (!session.endedAt || !session.snapshot) continue;
          const weekStart = weekOf(localDate(session.endedAt, query.timeZone));
          if (!weekSet.has(weekStart)) continue;
          const snapshot = readSnapshot(session.snapshot.payload);
          addToSeries(
            routines,
            session.sourceRoutineId ?? snapshot.sourceRoutineId,
            snapshot.routine.name,
            weekStart,
            session.totalVolumeKg ?? 0,
            session.completedSets ?? 0,
          );
        }

        const exercises = new Map<string, SeriesAccumulator>();
        for (const log of logs) {
          if (!log.session.endedAt) continue;
          const weekStart = weekOf(
            localDate(log.session.endedAt, query.timeZone),
          );
          if (!weekSet.has(weekStart)) continue;
          addToSeries(
            exercises,
            log.exerciseId,
            log.exercise.name,
            weekStart,
            (log.weight ?? 0) * (log.reps ?? 0),
            1,
          );
        }

        return {
          timeZone: query.timeZone,
          weeks: weeksCount,
          overall,
          muscles: serializeSeries(
            muscles.values(),
            weekStarts,
            currentWeekStart,
          ) as VolumeTrendResponse["muscles"],
          routines: serializeSeries(
            routines.values(),
            weekStarts,
            currentWeekStart,
          ),
          exercises: serializeSeries(
            exercises.values(),
            weekStarts,
            currentWeekStart,
          ),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
}
