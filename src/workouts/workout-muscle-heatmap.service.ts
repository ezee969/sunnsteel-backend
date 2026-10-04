import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { WorkoutAnalyticsProjection } from "@prisma/client";
import {
  DEFAULT_WEEK_STARTS_ON,
  isWeekStartsOn,
  MUSCLE_GROUPS,
  type MuscleGroup,
  type MuscleGroupHeatmapResponse,
  apiError,
  weekStartOf,
  type WeekStartsOn,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import { localDate } from "./analytics/analytics-contribution";
import type { MuscleGroupHeatmapQueryDto } from "./dto/muscle-group-heatmap.dto";

export const DEFAULT_HEATMAP_WEEKS = 8;

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function getHeatmapWeekStarts(
  currentWeekStart: string,
  weeks: number,
): string[] {
  return Array.from({ length: weeks }, (_, index) =>
    addUtcDays(currentWeekStart, (index - weeks + 1) * 7),
  );
}

const toWeightedSets = (value: number) => Math.round(value * 2) / 2;

@Injectable()
export class WorkoutMuscleHeatmapService {
  constructor(private readonly db: DatabaseService) {}

  async getMuscleHeatmap(
    userId: string,
    query: MuscleGroupHeatmapQueryDto,
  ): Promise<MuscleGroupHeatmapResponse> {
    const weeksCount = query.weeks ?? DEFAULT_HEATMAP_WEEKS;
    const localToday = localDate(new Date(), query.timeZone);

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
        const currentWeekStart = weekStartOf(localToday, weekStartsOn);
        const weekStarts = getHeatmapWeekStarts(currentWeekStart, weeksCount);
        const [projection] = await tx.$queryRaw<WorkoutAnalyticsProjection[]>`
          SELECT * FROM "WorkoutAnalyticsProjection"
          WHERE "userId" = ${userId} AND "active" AND "state" = 'READY' AND "timeZone" = ${query.timeZone} LIMIT 1`;
        if (!projection)
          throw new ServiceUnavailableException(
            apiError("ANALYTICS_NOT_READY"),
          );

        const rows = await tx.workoutMuscleRollup.findMany({
          where: {
            projectionId: projection.id,
            period: "DAY",
            date: { gte: weekStarts[0], lte: localToday },
          },
          orderBy: [{ date: "asc" }, { muscle: "asc" }],
          select: { date: true, muscle: true, completedSets: true },
        });
        const sums = new Map<string, number>();
        for (const row of rows) {
          if (!MUSCLE_GROUPS.includes(row.muscle as MuscleGroup)) continue;
          const key = `${weekStartOf(row.date, weekStartsOn)}:${row.muscle}`;
          sums.set(key, (sums.get(key) ?? 0) + row.completedSets);
        }
        const values = new Map(
          [...sums].map(([key, sets]) => [key, toWeightedSets(sets)]),
        );
        let peakWeightedSets = 0;
        const weeks = weekStarts.map((weekStart) => {
          let totalWeightedSets = 0;
          const muscles = MUSCLE_GROUPS.map((muscle) => {
            const weightedSets = values.get(`${weekStart}:${muscle}`) ?? 0;
            totalWeightedSets += weightedSets;
            peakWeightedSets = Math.max(peakWeightedSets, weightedSets);
            return { muscle, weightedSets };
          });
          return {
            weekStart,
            isCurrentWeek: weekStart === currentWeekStart,
            totalWeightedSets: toWeightedSets(totalWeightedSets),
            muscles,
          };
        });
        return {
          timeZone: query.timeZone,
          weeks,
          peakWeightedSets,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
}
