import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { WorkoutAnalyticsProjection } from "@prisma/client";
import {
  MUSCLE_GROUPS,
  type MuscleGroup,
  type MuscleGroupHeatmapResponse,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import { localDate, weekDate } from "./analytics/analytics-contribution";
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
    const currentWeekStart = weekDate(localDate(new Date(), query.timeZone));
    const weekStarts = getHeatmapWeekStarts(currentWeekStart, weeksCount);

    return this.db.$transaction(
      async (tx) => {
        const [projection] = await tx.$queryRaw<WorkoutAnalyticsProjection[]>`
          SELECT * FROM "WorkoutAnalyticsProjection"
          WHERE "userId" = ${userId} AND "active" AND "state" = 'READY' AND "timeZone" = ${query.timeZone} LIMIT 1`;
        if (!projection)
          throw new ServiceUnavailableException(
            "Workout analytics projection is not ready",
          );

        const rows = await tx.workoutMuscleRollup.findMany({
          where: {
            projectionId: projection.id,
            period: "WEEK",
            date: { gte: weekStarts[0], lte: currentWeekStart },
          },
          orderBy: [{ date: "asc" }, { muscle: "asc" }],
          select: { date: true, muscle: true, completedSets: true },
        });
        const values = new Map(
          rows
            .filter((row) => MUSCLE_GROUPS.includes(row.muscle as MuscleGroup))
            .map((row) => [
              `${row.date}:${row.muscle}`,
              toWeightedSets(row.completedSets),
            ]),
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
